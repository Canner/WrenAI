package utils

import (
	"testing"
)

func TestDockerList(t *testing.T) {
	containers, error := ListProcess()
	if error != nil {
		t.Errorf("Error: %v", error)
	}

	if len(containers) == 0 {
		t.Errorf("No containers found")
	}

	for _, container := range containers {
		t.Logf("Container ID: %s", container.ID)
		t.Logf("Container Name: %s", container.Names[0])
		for _, port := range container.Ports {
			t.Logf("Container IP: %s", port.IP)
			t.Logf("Container Port Type: %s", port.Type)
			t.Logf("Container PublicPort: %d", port.PublicPort)
			t.Logf("Container PrivatePort: %d", port.PrivatePort)
		}

		// for each container labels
		for key, value := range container.Labels {
			t.Logf("Container Label: %s=%s", key, value)
		}
	}
}
