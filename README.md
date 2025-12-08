# MCP Server MySQL

A Model Context Protocol (MCP) server that provides MySQL database operations. This server enables LLMs to interact with MySQL databases through a standardized protocol.

## Features

- **Database Management**: Create, drop, list, and switch databases
- **Table Operations**: Create, alter, drop, describe, and list tables
- **Data Queries**: Execute SELECT queries and retrieve results
- **Data Modification**: Execute INSERT, UPDATE, DELETE statements
- **Index Management**: Create and drop indexes

## Installation

```bash
npm install
npm run build
```

## Configuration

Set environment variables for database connection:

```bash
export MYSQL_HOST=localhost
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=your-password
export MYSQL_DATABASE=your-database  # optional
```

### Permission Controls

Control which write operations are allowed (all default to `true`):

```bash
export MYSQL_ALLOW_INSERT=true   # Set to "false" to disable INSERT
export MYSQL_ALLOW_UPDATE=true   # Set to "false" to disable UPDATE
export MYSQL_ALLOW_DELETE=false  # Set to "false" to disable DELETE
```

Or use the `connect` tool at runtime to specify connection parameters.

## Supported AI Applications

This MCP server can be used with any application that supports the Model Context Protocol (MCP):

- **[Claude Desktop](https://claude.ai/download)** - Anthropic's official desktop application
- **[Claude Code](https://github.com/anthropics/claude-code)** - Anthropic's official CLI tool for developers
- **[Cline](https://github.com/cline/cline)** - AI coding assistant VS Code extension
- **[Zed](https://zed.dev/)** - High-performance code editor with built-in AI
- **Any MCP-compatible application** - MCP is an open protocol developed by Anthropic

## Usage with Claude Desktop

### Using npx (Recommended)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@nilsir/mcp-server-mysql"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "your-password",
        "MYSQL_DATABASE": "your-database",
        "MYSQL_ALLOW_INSERT": "true",
        "MYSQL_ALLOW_UPDATE": "true",
        "MYSQL_ALLOW_DELETE": "false"
      }
    }
  }
}
```

### Using Local Installation

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-mysql/dist/index.js"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "your-password",
        "MYSQL_DATABASE": "your-database",
        "MYSQL_ALLOW_INSERT": "true",
        "MYSQL_ALLOW_UPDATE": "true",
        "MYSQL_ALLOW_DELETE": "false"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `connect` | Connect to a MySQL database |
| `query` | Execute SELECT queries |
| `execute` | Execute INSERT/UPDATE/DELETE queries |
| `list_databases` | List all databases |
| `list_tables` | List tables in a database |
| `describe_table` | Get table structure |
| `create_table` | Create a new table |
| `alter_table` | Modify table structure |
| `drop_table` | Drop a table |
| `create_database` | Create a new database |
| `drop_database` | Drop a database |
| `use_database` | Switch to a database |
| `create_index` | Create an index |
| `drop_index` | Drop an index |

## Examples

### Query data
```
Use the query tool with sql: "SELECT * FROM users WHERE active = ?"
and params: [true]
```

### Create a table
```
Use the create_table tool with:
- table: "users"
- columns: [
    {"name": "id", "type": "INT", "primaryKey": true, "autoIncrement": true},
    {"name": "email", "type": "VARCHAR(255)", "nullable": false},
    {"name": "created_at", "type": "TIMESTAMP", "default": "CURRENT_TIMESTAMP"}
  ]
```

### Insert data
```
Use the execute tool with sql: "INSERT INTO users (email) VALUES (?)"
and params: ["user@example.com"]
```

## License

MIT
