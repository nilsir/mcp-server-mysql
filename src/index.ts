#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import mysql, { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { z } from "zod";

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

// Validate that a query is read-only (for the query tool)
function validateReadOnlyQuery(sql: string): void {
  const normalizedSql = sql.trim().toUpperCase();

  // List of forbidden keywords for read-only queries
  const forbiddenKeywords = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "CREATE",
    "ALTER",
    "TRUNCATE",
    "RENAME",
    "REPLACE",
    "GRANT",
    "REVOKE",
    "LOCK",
    "UNLOCK",
  ];

  for (const keyword of forbiddenKeywords) {
    if (normalizedSql.startsWith(keyword)) {
      throw new Error(
        `${keyword} operations are not allowed in query tool. Use the execute tool for data modifications or appropriate DDL tools for schema changes.`
      );
    }
  }
}

// Initialize connection pool
async function getPool(): Promise<Pool> {
  if (!pool) {
    pool = mysql.createPool(getConnectionConfig());
  }
  return pool;
}

// Create MCP server using high-level McpServer API
const server = new McpServer({
  name: "mcp-server-mysql",
  version: "1.0.0",
});

// Tool: connect
server.tool(
  "connect",
  "Connect to a MySQL database. If not called explicitly, will use environment variables for connection.",
  {
    host: z.string().optional().describe("Database host"),
    port: z.number().optional().describe("Database port"),
    user: z.string().optional().describe("Database user"),
    password: z.string().optional().describe("Database password"),
    database: z.string().optional().describe("Database name"),
  },
  async ({ host, port, user, password, database }) => {
    const config = {
      host: host || process.env.MYSQL_HOST || "localhost",
      port: port || parseInt(process.env.MYSQL_PORT || "3306", 10),
      user: user || process.env.MYSQL_USER || "root",
      password: password || process.env.MYSQL_PASSWORD || "",
      database: database,
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

    const output = {
      success: true,
      host: config.host,
      port: config.port,
      database: config.database || null,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully connected to MySQL server at ${config.host}:${config.port}${config.database ? ` (database: ${config.database})` : ""}`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: query
server.tool(
  "query",
  "Execute a SELECT query and return results. Use this for reading data.",
  {
    sql: z.string().describe("SQL SELECT query to execute"),
    params: z.array(z.unknown()).optional().describe("Query parameters for prepared statement"),
  },
  async ({ sql, params }) => {
    // Validate that this is a read-only query
    validateReadOnlyQuery(sql);

    const p = await getPool();
    const [rows] = await p.query<RowDataPacket[]>(sql, params || []);

    const output = {
      rows: rows as Record<string, unknown>[],
      rowCount: rows.length,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(rows, null, 2),
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: execute
server.tool(
  "execute",
  "Execute an INSERT, UPDATE, DELETE or other modifying query. Returns affected rows count.",
  {
    sql: z.string().describe("SQL query to execute"),
    params: z.array(z.unknown()).optional().describe("Query parameters for prepared statement"),
  },
  async ({ sql, params }) => {
    const p = await getPool();

    // Check if the operation is allowed
    checkSqlPermission(sql);

    const [result] = await p.execute<ResultSetHeader>(sql, params || []);

    const output = {
      affectedRows: result.affectedRows,
      insertId: result.insertId,
      changedRows: result.changedRows,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(output, null, 2),
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: list_databases
server.tool(
  "list_databases",
  "List all databases on the MySQL server",
  {},
  async () => {
    const p = await getPool();
    const [rows] = await p.query<RowDataPacket[]>("SHOW DATABASES");

    const databases = rows.map((row) => row.Database as string);
    const output = { databases };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(databases, null, 2),
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: list_tables
server.tool(
  "list_tables",
  "List all tables in the current or specified database",
  {
    database: z.string().optional().describe("Database name (optional, uses current if not specified)"),
  },
  async ({ database }) => {
    const p = await getPool();

    let sql = "SHOW TABLES";
    if (database) {
      sql = `SHOW TABLES FROM \`${database}\``;
    }

    const [rows] = await p.query<RowDataPacket[]>(sql);

    const tables = rows.map((row) => Object.values(row)[0] as string);
    const output = { tables, database: database || null };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(tables, null, 2),
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: describe_table
server.tool(
  "describe_table",
  "Get the structure/schema of a table",
  {
    table: z.string().describe("Table name"),
    database: z.string().optional().describe("Database name (optional)"),
  },
  async ({ table, database }) => {
    const p = await getPool();

    const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
    const [rows] = await p.query<RowDataPacket[]>(`DESCRIBE ${tableName}`);

    const columns = rows as Array<{
      Field: string;
      Type: string;
      Null: string;
      Key: string;
      Default: string | null;
      Extra: string;
    }>;
    const output = { table, database: database || null, columns };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(rows, null, 2),
        },
      ],
      structuredContent: output,
    };
  }
);

// Column definition schema for create_table
const columnSchema = z.object({
  name: z.string().describe("Column name"),
  type: z.string().describe("Column type (e.g., VARCHAR(255), INT, TEXT)"),
  nullable: z.boolean().optional().describe("Whether column can be null"),
  primaryKey: z.boolean().optional().describe("Whether this is the primary key"),
  autoIncrement: z.boolean().optional().describe("Whether to auto increment"),
  default: z.string().optional().describe("Default value"),
});

// Tool: create_table
server.tool(
  "create_table",
  "Create a new table with specified columns",
  {
    table: z.string().describe("Table name"),
    columns: z.array(columnSchema).describe("Column definitions"),
    database: z.string().optional().describe("Database name (optional)"),
  },
  async ({ table, columns, database }) => {
    const p = await getPool();

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

    const output = { success: true, table, database: database || null };

    return {
      content: [
        {
          type: "text" as const,
          text: `Table ${table} created successfully`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: alter_table
server.tool(
  "alter_table",
  "Modify an existing table structure",
  {
    table: z.string().describe("Table name"),
    operation: z.enum(["ADD", "DROP", "MODIFY", "RENAME"]).describe("Type of alteration"),
    column: z.string().describe("Column name"),
    definition: z.string().optional().describe("Column definition for ADD/MODIFY (e.g., 'VARCHAR(255) NOT NULL')"),
    newName: z.string().optional().describe("New name for RENAME operation"),
    database: z.string().optional().describe("Database name (optional)"),
  },
  async ({ table, operation, column, definition, newName, database }) => {
    const p = await getPool();

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

    const output = {
      success: true,
      table,
      operation,
      column,
      newName: newName || null,
      database: database || null,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: `Table ${table} altered successfully (${operation} ${column})`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: drop_table
server.tool(
  "drop_table",
  "Drop/delete a table",
  {
    table: z.string().describe("Table name"),
    database: z.string().optional().describe("Database name (optional)"),
  },
  async ({ table, database }) => {
    const p = await getPool();

    const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
    await p.execute(`DROP TABLE ${tableName}`);

    const output = { success: true, table, database: database || null };

    return {
      content: [
        {
          type: "text" as const,
          text: `Table ${table} dropped successfully`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: create_database
server.tool(
  "create_database",
  "Create a new database",
  {
    database: z.string().describe("Database name"),
    charset: z.string().optional().describe("Character set (default: utf8mb4)"),
    collation: z.string().optional().describe("Collation (default: utf8mb4_unicode_ci)"),
  },
  async ({ database, charset, collation }) => {
    const p = await getPool();
    const cs = charset || "utf8mb4";
    const col = collation || "utf8mb4_unicode_ci";

    await p.execute(
      `CREATE DATABASE \`${database}\` CHARACTER SET ${cs} COLLATE ${col}`
    );

    const output = { success: true, database, charset: cs, collation: col };

    return {
      content: [
        {
          type: "text" as const,
          text: `Database ${database} created successfully`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: drop_database
server.tool(
  "drop_database",
  "Drop/delete a database",
  {
    database: z.string().describe("Database name"),
  },
  async ({ database }) => {
    const p = await getPool();

    await p.execute(`DROP DATABASE \`${database}\``);

    const output = { success: true, database };

    return {
      content: [
        {
          type: "text" as const,
          text: `Database ${database} dropped successfully`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: use_database
server.tool(
  "use_database",
  "Switch to a different database",
  {
    database: z.string().describe("Database name"),
  },
  async ({ database }) => {
    const p = await getPool();

    await p.query(`USE \`${database}\``);

    const output = { success: true, database };

    return {
      content: [
        {
          type: "text" as const,
          text: `Switched to database ${database}`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: create_index
server.tool(
  "create_index",
  "Create an index on a table",
  {
    table: z.string().describe("Table name"),
    indexName: z.string().describe("Index name"),
    columns: z.array(z.string()).describe("Column names to index"),
    unique: z.boolean().optional().describe("Whether this is a unique index"),
    database: z.string().optional().describe("Database name (optional)"),
  },
  async ({ table, indexName, columns, unique, database }) => {
    const p = await getPool();

    const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
    const columnList = columns.map((c) => `\`${c}\``).join(", ");
    const uniqueStr = unique ? "UNIQUE " : "";

    await p.execute(
      `CREATE ${uniqueStr}INDEX \`${indexName}\` ON ${tableName} (${columnList})`
    );

    const output = {
      success: true,
      table,
      indexName,
      columns,
      unique: unique || false,
      database: database || null,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: `Index ${indexName} created successfully on ${table}`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: drop_index
server.tool(
  "drop_index",
  "Drop an index from a table",
  {
    table: z.string().describe("Table name"),
    indexName: z.string().describe("Index name"),
    database: z.string().optional().describe("Database name (optional)"),
  },
  async ({ table, indexName, database }) => {
    const p = await getPool();

    const tableName = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;
    await p.execute(`DROP INDEX \`${indexName}\` ON ${tableName}`);

    const output = {
      success: true,
      table,
      indexName,
      database: database || null,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: `Index ${indexName} dropped from ${table}`,
        },
      ],
      structuredContent: output,
    };
  }
);

// Tool: health_check
server.tool(
  "health_check",
  "Check database connection health and get server status",
  {},
  async () => {
    const startTime = Date.now();
    const p = await getPool();

    // Test connection with ping
    const connection = await p.getConnection();
    await connection.ping();
    connection.release();

    const pingLatency = Date.now() - startTime;

    // Get server version and status
    const [versionRows] = await p.query<RowDataPacket[]>("SELECT VERSION() as version");
    const [statusRows] = await p.query<RowDataPacket[]>("SHOW STATUS WHERE Variable_name IN ('Uptime', 'Threads_connected', 'Questions')");

    const version = versionRows[0]?.version || "unknown";
    const status: Record<string, string> = {};
    for (const row of statusRows) {
      status[row.Variable_name] = row.Value;
    }

    const output = {
      healthy: true,
      pingLatencyMs: pingLatency,
      serverVersion: version,
      uptime: status.Uptime ? parseInt(status.Uptime, 10) : null,
      threadsConnected: status.Threads_connected ? parseInt(status.Threads_connected, 10) : null,
      totalQueries: status.Questions ? parseInt(status.Questions, 10) : null,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: `Database connection healthy (ping: ${pingLatency}ms, version: ${version})`,
        },
      ],
      structuredContent: output,
    };
  }
);

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
