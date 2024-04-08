package utils

import (
	"testing"
)

func TestFindWrenUIContainer(t *testing.T) {
	container, error := findWrenUIContainer()
	if error != nil {
		t.Errorf("Error: %v", error)
	}

	t.Logf("Container ID: %s", container.ID)
	t.Logf("Container Name: %s", container.Names[0])
	for _, port := range container.Ports {
		t.Logf("Container IP: %s", port.IP)
		t.Logf("Container Port Type: %s", port.Type)
		t.Logf("Container PublicPort: %d", port.PublicPort)
		t.Logf("Container PrivatePort: %d", port.PrivatePort)
	}
}
