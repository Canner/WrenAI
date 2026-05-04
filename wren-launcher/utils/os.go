package utils

import (
	"fmt"
	"os/exec"
	"runtime"
)

type OS int

const (
	// Windows is the Windows operating system.
	Windows OS = iota
	// Darwin is the Apple operating system.
	Darwin
	// Linux is the Linux operating system.
	Linux
	// Unknown is an unknown operating system.
	Unknown
)

func DetectOS() OS {
	switch runtime.GOOS {
	case "windows":
		return Windows
	case "darwin":
		return Darwin
	case "linux":
		return Linux
	default:
		return Unknown
	}
}

func Openbrowser(url string) error {
	var err error

	switch DetectOS() {
	case Linux:
		err = exec.Command("xdg-open", url).Start()
	case Windows:
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case Darwin:
		err = exec.Command("open", url).Start()
	default:
		err = fmt.Errorf("unsupported platform")
	}
	return err
}

func OpenDockerDaemon() error {
	var err error

	switch DetectOS() {
	case Linux:
		// systemctl --user start docker-desktop
		err = exec.Command("systemctl", "--user", "start", "docker-desktop").Run()
	case Windows:
		// C:\Program Files\Docker\Docker\Docker Desktop.exe
		err = exec.Command("C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe").Run()
	case Darwin:
		cmd := exec.Command("open", "-a", "Docker")
		err = cmd.Run()
	default:
		err = fmt.Errorf("unsupported platform")
	}
	return err
}
