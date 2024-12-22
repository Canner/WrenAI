package utils

import (
	"fmt"
	"net"

	"github.com/pterm/pterm"
)

func ifPortUsed(port int) bool {
	// listen on port to check if it's used
	_, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	return err != nil
}

func FindAvailablePort(defaultPort int) int {
	// Find an available port
	// Start from the default port and increment by 1
	// until a port is found that is not in use
	for port := defaultPort; port < defaultPort+100; port++ {
		pterm.Info.Printf("Checking if port %d is available\n", port)

		if !ifPortUsed(port) {
			// Return the port if it's not used
			return port
		} else if IfPortUsedByWrenUI(port) || IfPortUsedByAIService(port) {
			// Return the port if it's used, but used by wrenAI
			return port
		}
	}

	// If no port is available, return 0
	return 0
}
