BINARY_NAME=wren-launcher

build:
	env GOARCH=amd64 GOOS=darwin CGO_ENABLED=1 go build -o dist/${BINARY_NAME}-darwin main.go
	env GOARCH=amd64 GOOS=linux go build -o dist/${BINARY_NAME}-linux main.go
	env GOARCH=amd64 GOOS=windows go build -o dist/${BINARY_NAME}-windows main.go

clean:
	go clean
	rm -rf dist

rebuild: clean build
