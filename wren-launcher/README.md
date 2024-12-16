## How to build
```bash
# mac
go build main.go
# windows
env GOOS=windows GOARCH=amd64 go build main.go
```

## How to update dependencies

```bash
# Update a single dependency
go get example.com/some/package@latest

# Update all dependencies
go get -u ./...

# Clean up and ensure the module files are correct
go mod tidy

# Verify the updates
go test ./...

```
