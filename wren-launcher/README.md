## How to build
```bash
# mac
go build main.go
# windows
env GOOS=windows GOARCH=amd64 go build main.go
```

## Code Quality
```bash
make check  # Run all checks (fmt, vet, lint)
make test   # Run tests
make fmt    # Format code
make vet    # Run go vet
make lint   # Run golangci-lint
```

## Continuous Integration

This project uses GitHub Actions for CI/CD. The workflow runs automatically on:

- **Push to main branch**: Runs all checks and tests
- **Pull Request with label `launcher`**: Runs all checks and tests when PR is labeled
- **Manual trigger**: Can be triggered manually via GitHub Actions UI

### CI Jobs:

1. **Lint and Test**: 
   - Code formatting check
   - Go vet analysis
   - golangci-lint checks
   - Unit tests
   - All quality checks

2. **Security Scan**: 
   - Gosec security analysis
   - Go module verification

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
