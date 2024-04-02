package utils

import (
	"fmt"
	"net"
)

func checkIfPortUsed(port int) bool {
	// listen on port to check if it's used
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))

	// Close the listener
	defer func(ln net.Listener) {
		if err := ln.Close(); err != nil {
			panic(err)
		}
	}(ln)

	return err != nil
}

func FindAvailablePort(defaultPort int) int {
	// Find an available port
	// Start from the default port and increment by 1
	// until a port is found that is not in use
	for port := defaultPort; port < defaultPort+100; port++ {
		if !checkIfPortUsed(port) {
			return port
		}
	}

	// If no port is available, return 0
	return 0
}
