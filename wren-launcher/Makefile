BINARY_NAME=wren-launcher

# Build targets
build:
	env GOARCH=amd64 GOOS=darwin CGO_ENABLED=1 go build -o dist/${BINARY_NAME}-darwin main.go
	env GOARCH=arm64 GOOS=darwin CGO_ENABLED=1 go build -o dist/${BINARY_NAME}-darwin-arm64 main.go
	env GOARCH=amd64 GOOS=linux CGO_ENABLED=0 go build -o dist/${BINARY_NAME}-linux main.go
	env GOARCH=arm64 GOOS=linux CGO_ENABLED=0 go build -o dist/${BINARY_NAME}-linux-arm64 main.go
	env GOARCH=amd64 GOOS=windows CGO_ENABLED=0 go build -o dist/${BINARY_NAME}-windows.exe main.go
	cd ./dist; chmod +x ${BINARY_NAME}-darwin && chmod +x ${BINARY_NAME}-darwin-arm64 && chmod +x ${BINARY_NAME}-linux && chmod +x ${BINARY_NAME}-linux-arm64 \
	&& tar zcvf ${BINARY_NAME}-darwin.tar.gz ${BINARY_NAME}-darwin \
	&& tar zcvf ${BINARY_NAME}-darwin-arm64.tar.gz ${BINARY_NAME}-darwin-arm64 \
	&& tar zcvf ${BINARY_NAME}-linux.tar.gz ${BINARY_NAME}-linux \
	&& tar zcvf ${BINARY_NAME}-linux-arm64.tar.gz ${BINARY_NAME}-linux-arm64 \
	&& zip ${BINARY_NAME}-windows.zip ${BINARY_NAME}-windows.exe

clean:
	go clean
	rm -rf dist

rebuild: clean build

# Code quality targets
.PHONY: fmt
fmt:
	go fmt ./...

.PHONY: imports
imports:
	$(shell go env GOPATH)/bin/goimports -w .

.PHONY: vet
vet:
	go vet ./...

.PHONY: lint
lint:
	golangci-lint run

.PHONY: lint-fix
lint-fix:
	golangci-lint run --fix

.PHONY: check
check: fmt vet lint

.PHONY: fix
fix: fmt imports lint-fix

.PHONY: test
test:
	go test ./...

.PHONY: help
help:
	@echo "Available targets:"
	@echo "  build      - Build binaries for all platforms"
	@echo "  clean      - Clean build artifacts"
	@echo "  rebuild    - Clean and build"
	@echo "  fmt        - Format Go code"
	@echo "  imports    - Fix imports"
	@echo "  vet        - Run go vet"
	@echo "  lint       - Run golangci-lint"
	@echo "  lint-fix   - Run golangci-lint with auto-fix"
	@echo "  check      - Run fmt, vet, and lint"
	@echo "  fix        - Run fmt, imports, and lint-fix"
	@echo "  test       - Run tests"
	@echo "  help       - Show this help"
