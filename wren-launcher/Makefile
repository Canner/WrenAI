BINARY_NAME=wren-launcher

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
