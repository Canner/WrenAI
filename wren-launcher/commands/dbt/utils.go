package dbt

import (
	"os"
	"path/filepath"
)

// isDbtProjectValid checks if the given path is a valid dbt project directory
func IsDbtProjectValid(projectPath string) bool {
	// Check if path exists and is a directory
	if !DirExists(projectPath) {
		return false
	}

	// Check for dbt_project.yml (required file for dbt projects)
	dbtProjectFile := filepath.Join(projectPath, "dbt_project.yml")
	return FileExists(dbtProjectFile)
}

// DirExists checks if a directory exists
func DirExists(path string) bool {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}
	return info.IsDir()
}

// FileExists checks if a file exists
func FileExists(path string) bool {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}
