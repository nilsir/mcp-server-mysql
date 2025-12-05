#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import mysql, { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

// Connection pool
let pool: Pool | null = null;

// Permission flags from environment variables
const ALLOW_INSERT = process.env.MYSQL_ALLOW_INSERT !== "false";
const ALLOW_UPDATE = process.env.MYSQL_ALLOW_UPDATE !== "false";
const ALLOW_DELETE = process.env.MYSQL_ALLOW_DELETE !== "false";

// Get connection configuration from environment variables
function getConnectionConfig() {
  return {
    host: process.env.MYSQL_HOST || "localhost",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  };
}

// Check if a SQL statement is allowed based on permissions
function checkSqlPermission(sql: string): void {
  const normalizedSql = sql.trim().toUpperCase();

  if (!ALLOW_INSERT && normalizedSql.startsWith("INSERT")) {
    throw new Error("INSERT operations are disabled. Set MYSQL_ALLOW_INSERT=true to enable.");
  }
  if (!ALLOW_UPDATE && normalizedSql.startsWith("UPDATE")) {
    throw new Error("UPDATE operations are disabled. Set MYSQL_ALLOW_UPDATE=true to enable.");
  }
  if (!ALLOW_DELETE && normalizedSql.startsWith("DELETE")) {
    throw new Error("DELETE operations are disabled. Set MYSQL_ALLOW_DELETE=true to enable.");
  }
}

// Initialize connection pool
async function getPool(): Promise<Pool> {
  if (!pool) {
    pool = mysql.createPool(getConnectionConfig());
  }
  return pool;
}

// Create MCP server
const server = new Server(
  {
    name: "mcp-server-mysql",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "connect",
        description:
          "Connect to a MySQL database. If not called explicitly, will use environment variables for connection.",
        inputSchema: {
          type: "object" as const,
          properties: {
            host: { type: "string", description: "Database host" },
            port: { type: "number", description: "Database port" },
            user: { type: "string", description: "Database user" },
            password: { type: "string", description: "Database password" },
            database: { type: "string", description: "Database name" },
          },
        },
      },
      {
        name: "query",
        description:
          "Execute a SELECT query and return results. Use this for reading data.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sql: { type: "string", description: "SQL SELECT query to execute" },
            params: {
              type: "array",
              items: {},
              description: "Query parameters for prepared statement",
            },
          },
          required: ["sql"],
        },
      },
      {
        name: "execute",
        description:
          "Execute an INSERT, UPDATE, DELETE or other modifying query. Returns affected rows count.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sql: { type: "string", description: "SQL query to execute" },
            params: {
              type: "array",
              items: {},
              description: "Query parameters for prepared statement",
            },
          },
          required: ["sql"],
        },
      },
      {
        name: "list_databases",
        description: "List all databases on the MySQL server",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "list_tables",
        description: "List all tables in the current or specified database",
        inputSchema: {
          type: "object" as const,
          properties: {
            database: {
              type: "string",
              description: "Database name (optional, uses current if not specified)",
            },
          },
        },
      },
      {
        name: "describe_table",
        description: "Get the structure/schema of a table",
        inputSchema: {
          type: "object" as const,
          properties: {
            table: { type: "string", description: "Table name" },
            database: {
              type: "string",
              description: "Database name (optional)",
            },
          },
          required: ["table"],
        },
      },
      {
        name: "create_table",
        description: "Create a new table with specified columns",
        inputSchema: {
          type: "object" as const,
          properties: {
            table: { type: "string", description: "Table name" },
            columns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Column name" },
                  type: {
                    type: "string",
                    description: "Column type (e.g., VARCHAR(255), INT, TEXT)",
                  },
                  nullable: {
                    type: "boolean",
                    description: "Whether column can be null",
                  },
                  primaryKey: {
                    type: "boolean",
                    description: "Whether this is the primary key",
                  },
                  autoIncrement: {
                    type: "boolean",
                    description: "Whether to auto increment",
                  },
                  default: {
                    type: "string",
                    description: "Default value",
                  },
                },
                required: ["name", "type"],
              },
              description: "Column definitions",
            },
            database: {
              type: "string",
              description: "Database name (optional)",
            },
          },
          required: ["table", "columns"],
        },
      },
      {
        name: "alter_table",
        description: "Modify an existing table structure",
        inputSchema: {
          type: "object" as const,
          properties: {
            table: { type: "string", description: "Table name" },
            operation: {
              type: "string",
              enum: ["ADD", "DROP", "MODIFY", "RENAME"],
              description: "Type of alteration",
            },
            column: { type: "string", description: "Column name" },
            definition: {
              type: "string",
              description:
                "Column definition for ADD/MODIFY (e.g., 'VARCHAR(255) NOT NULL')",
            },
            newName: {
              type: "string",
              description: "New name for RENAME operation",
            },
            database: {
              type: "string",
              description: "Database name (optional)",
            },
          },
          required: ["table", "operation", "column"],
        },
      },
      {
        name: "drop_table",
        description: "Drop/delete a table",
        inputSchema: {
          type: "object" as const,
          properties: {
            table: { type: "string", description: "Table name" },
            database: {
              type: "string",
              description: "Database name (optional)",
            },
          },
          required: ["table"],
        },
      },
      {
        name: "create_database",
        description: "Create a new database",
        inputSchema: {
          type: "object" as const,
          properties: {
            database: { type: "string", description: "Database name" },
            charset: {
              type: "string",
              description: "Character set (default: utf8mb4)",
            },
            collation: {
              type: "string",
              description: "Collation (default: utf8mb4_unicode_ci)",
            },
          },
          required: ["database"],
        },
      },
      {
        name: "drop_database",
        description: "Drop/delete a database",
        inputSchema: {
          type: "object" as const,
          properties: {
            database: { type: "string", description: "Database name" },
          },
          required: ["database"],
        },
      },
      {
        name: "use_database",
        description: "Switch to a different database",
        inputSchema: {
          type: "object" as const,
          properties: {
            database: { type: "string", description: "Database name" },
          },
          required: ["database"],
        },
      },
      {
        name: "create_index",
        description: "Create an index on a table",
        inputSchema: {
          type: "object" as const,
          properties: {
            table: { type: "string", description: "Table name" },
            indexName: { type: "string", description: "Index name" },
            columns: {
              type: "array",
              items: { type: "string" },
              description: "Column names to index",
            },
            unique: {
              type: "boolean",
              description: "Whether this is a unique index",
            },
            database: {
              type: "string",
              description: "Database name (optional)",
            },
          },
          required: ["table", "indexName", "columns"],
        },
      },
      {
        name: "drop_index",
        description: "Drop an index from a table",
        inputSchema: {
          type: "object" as const,
          properties: {
            table: { type: "string", description: "Table name" },
            indexName: { type: "string", description: "Index name" },
            database: {
              type: "string",
              description: "Database name (optional)",
            },
          },
          required: ["table", "indexName"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "connect": {
        const config = {
          host: (args?.host as string) || process.env.MYSQL_HOST || "localhost",
          port: (args?.port as number) || parseInt(process.env.MYSQL_PORT || "3306", 10),
          user: (args?.user as string) || process.env.MYSQL_USER || "root",
          password: (args?.password as string) || process.env.MYSQL_PASSWORD || "",
          database: args?.database as string | undefined,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
        };

        // Close existing pool if any
        if (pool) {
          await pool.end();
        }

        pool = mysql.createPool(config);

        // Test connection
        const connection = await pool.getConnection();
        connection.release();

        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully connected to MySQL server at ${config.host}:${config.port}${config.database ? ` (database: ${config.database})` : ""}`,
            },
          ],
        };
      }

      case "query": {
        const p = await getPool();
        const sql = args?.sql as string;
        const params = (args?.params as unknown[]) || [];

        const [rows] = await p.query<RowDataPacket[]>(sql, params);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      }

      case "execute": {
        const p = await getPool();
        const sql = args?.sql as string;
        const params = (args?.params as unknown[]) || [];

        // Check if the operation is allowed
        checkSqlPermission(sql);

        const [result] = await p.execute<ResultSetHeader>(sql, params);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  affectedRows: result.affectedRows,
                  insertId: result.insertId,
                  changedRows: result.changedRows,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "list_databases": {
        const p = await getPool();
        const [rows] = await p.query<RowDataPacket[]>("SHOW DATABASES");

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                rows.map((row) => row.Database),
                null,
                2
              ),
            },
          ],
        };
      }

      case "list_tables": {
        const p = await getPool();
        const database = args?.database as string | undefined;

        let sql = "SHOW TABLES";
        if (database) {
          sql = `SHOW TABLES FROM \`${database}\``;
        }

        const [rows] = await p.query<RowDataPacket[]>(sql);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                rows.map((row) => Object.values(row)[0]),
                null,
                2
              ),
            },
          ],
        };
      }

      case "describe_table": {
        const p = await getPool();
        const table = args?.table as string;
        const database = args?.database as string | undefined;

        const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
        const [rows] = await p.query<RowDataPacket[]>(`DESCRIBE ${tableName}`);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      }

      case "create_table": {
        const p = await getPool();
        const table = args?.table as string;
        const columns = args?.columns as Array<{
          name: string;
          type: string;
          nullable?: boolean;
          primaryKey?: boolean;
          autoIncrement?: boolean;
          default?: string;
        }>;
        const database = args?.database as string | undefined;

        const columnDefs = columns.map((col) => {
          let def = `\`${col.name}\` ${col.type}`;
          if (col.nullable === false) def += " NOT NULL";
          if (col.autoIncrement) def += " AUTO_INCREMENT";
          if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
          if (col.primaryKey) def += " PRIMARY KEY";
          return def;
        });

        const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
        const sql = `CREATE TABLE ${tableName} (${columnDefs.join(", ")})`;

        await p.execute(sql);

        return {
          content: [
            {
              type: "text" as const,
              text: `Table ${table} created successfully`,
            },
          ],
        };
      }

      case "alter_table": {
        const p = await getPool();
        const table = args?.table as string;
        const operation = args?.operation as string;
        const column = args?.column as string;
        const definition = args?.definition as string | undefined;
        const newName = args?.newName as string | undefined;
        const database = args?.database as string | undefined;

        const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
        let sql: string;

        switch (operation) {
          case "ADD":
            sql = `ALTER TABLE ${tableName} ADD COLUMN \`${column}\` ${definition}`;
            break;
          case "DROP":
            sql = `ALTER TABLE ${tableName} DROP COLUMN \`${column}\``;
            break;
          case "MODIFY":
            sql = `ALTER TABLE ${tableName} MODIFY COLUMN \`${column}\` ${definition}`;
            break;
          case "RENAME":
            sql = `ALTER TABLE ${tableName} RENAME COLUMN \`${column}\` TO \`${newName}\``;
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }

        await p.execute(sql);

        return {
          content: [
            {
              type: "text" as const,
              text: `Table ${table} altered successfully (${operation} ${column})`,
            },
          ],
        };
      }

      case "drop_table": {
        const p = await getPool();
        const table = args?.table as string;
        const database = args?.database as string | undefined;

        const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
        await p.execute(`DROP TABLE ${tableName}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Table ${table} dropped successfully`,
            },
          ],
        };
      }

      case "create_database": {
        const p = await getPool();
        const database = args?.database as string;
        const charset = (args?.charset as string) || "utf8mb4";
        const collation = (args?.collation as string) || "utf8mb4_unicode_ci";

        await p.execute(
          `CREATE DATABASE \`${database}\` CHARACTER SET ${charset} COLLATE ${collation}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Database ${database} created successfully`,
            },
          ],
        };
      }

      case "drop_database": {
        const p = await getPool();
        const database = args?.database as string;

        await p.execute(`DROP DATABASE \`${database}\``);

        return {
          content: [
            {
              type: "text" as const,
              text: `Database ${database} dropped successfully`,
            },
          ],
        };
      }

      case "use_database": {
        const p = await getPool();
        const database = args?.database as string;

        await p.query(`USE \`${database}\``);

        return {
          content: [
            {
              type: "text" as const,
              text: `Switched to database ${database}`,
            },
          ],
        };
      }

      case "create_index": {
        const p = await getPool();
        const table = args?.table as string;
        const indexName = args?.indexName as string;
        const columns = args?.columns as string[];
        const unique = args?.unique as boolean | undefined;
        const database = args?.database as string | undefined;

        const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
        const columnList = columns.map((c) => `\`${c}\``).join(", ");
        const uniqueStr = unique ? "UNIQUE " : "";

        await p.execute(
          `CREATE ${uniqueStr}INDEX \`${indexName}\` ON ${tableName} (${columnList})`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Index ${indexName} created successfully on ${table}`,
            },
          ],
        };
      }

      case "drop_index": {
        const p = await getPool();
        const table = args?.table as string;
        const indexName = args?.indexName as string;
        const database = args?.database as string | undefined;

        const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
        await p.execute(`DROP INDEX \`${indexName}\` ON ${tableName}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Index ${indexName} dropped from ${table}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP MySQL Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
