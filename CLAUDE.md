# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build    # Compile TypeScript to dist/
npm run dev      # Watch mode compilation
npm start        # Run the compiled server
```

## Architecture

This is an MCP (Model Context Protocol) server that provides MySQL database operations. It uses:

- `@modelcontextprotocol/sdk` - MCP server framework
- `mysql2/promise` - MySQL client with Promise API
- Connection pooling for efficient database connections

The server runs on stdio transport and exposes tools for:
- Database management (create, drop, use, list)
- Table operations (create, alter, drop, describe, list)
- Data queries (SELECT via `query`, INSERT/UPDATE/DELETE via `execute`)
- Index management (create, drop)

## Configuration

Connection via environment variables:
- `MYSQL_HOST` - Database host (default: localhost)
- `MYSQL_PORT` - Database port (default: 3306)
- `MYSQL_USER` - Database user (default: root)
- `MYSQL_PASSWORD` - Database password
- `MYSQL_DATABASE` - Default database name

Permission controls (all default to `true`):
- `MYSQL_ALLOW_INSERT` - Set to `false` to disable INSERT operations
- `MYSQL_ALLOW_UPDATE` - Set to `false` to disable UPDATE operations
- `MYSQL_ALLOW_DELETE` - Set to `false` to disable DELETE operations

Or use the `connect` tool at runtime with explicit parameters.

## Usage with Claude Desktop

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mcp-server-mysql/dist/index.js"],
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

## Release Workflow

When releasing a new version, follow these steps in order:

1. Update version in `package.json`
2. Commit changes: `git add . && git commit -m "chore: release vX.X.X"`
3. Create git tag: `git tag -a vX.X.X -m "vX.X.X"`
4. Push to GitHub: `git push origin master --tags`
5. Create GitHub release: `gh release create vX.X.X --title "vX.X.X" --notes "..."`
6. Publish to npm: `npm publish --access public`

**Important**: GitHub and npm versions must always be in sync.
