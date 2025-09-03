package dbt

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"gopkg.in/yaml.v3"
)

// AnalyzeDbtProfiles reads and analyzes a dbt profiles.yml file
func AnalyzeDbtProfiles(profilesPath string) (*DbtProfiles, error) {
	// Read the profiles.yml file
	data, err := os.ReadFile(profilesPath) // #nosec G304 -- profilesPath is controlled by application
	if err != nil {
		return nil, fmt.Errorf("failed to read profiles file %s: %w", profilesPath, err)
	}

	// Parse YAML
	var rawProfiles map[string]interface{}
	if err := yaml.Unmarshal(data, &rawProfiles); err != nil {
		return nil, fmt.Errorf("failed to parse YAML in file %s: %w", profilesPath, err)
	}

	// Convert to structured format
	profiles := &DbtProfiles{
		Profiles: make(map[string]DbtProfile),
	}

	// Extract config if present
	if config, exists := rawProfiles["config"]; exists {
		if configMap, ok := config.(map[string]interface{}); ok {
			profiles.Config = configMap
		}
		delete(rawProfiles, "config")
	}

	// Process each profile
	for profileName, profileData := range rawProfiles {
		if profileMap, ok := profileData.(map[string]interface{}); ok {
			profile, err := parseProfile(profileMap)
			if err != nil {
				return nil, fmt.Errorf("failed to parse profile %s: %w", profileName, err)
			}
			profiles.Profiles[profileName] = *profile
		}
	}

	return profiles, nil
}

// parseProfile converts a raw profile map to DbtProfile struct
func parseProfile(profileMap map[string]interface{}) (*DbtProfile, error) {
	profile := &DbtProfile{
		Outputs: make(map[string]DbtConnection),
	}

	// Extract target
	if target, exists := profileMap["target"]; exists {
		if targetStr, ok := target.(string); ok {
			profile.Target = targetStr
		}
	}

	// Extract outputs
	if outputs, exists := profileMap["outputs"]; exists {
		if outputsMap, ok := outputs.(map[string]interface{}); ok {
			for outputName, outputData := range outputsMap {
				if outputMap, ok := outputData.(map[string]interface{}); ok {
					connection, err := parseConnection(outputMap)
					if err != nil {
						return nil, fmt.Errorf("failed to parse output %s: %w", outputName, err)
					}
					profile.Outputs[outputName] = *connection
				}
			}
		}
	}

	return profile, nil
}

// parseConnection converts a raw connection map to DbtConnection struct
func parseConnection(connectionMap map[string]interface{}) (*DbtConnection, error) {
	connection := &DbtConnection{
		Additional: make(map[string]interface{}),
	}

	// Helper function to safely extract string values
	getString := func(key string) string {
		if value, exists := connectionMap[key]; exists {
			if str, ok := value.(string); ok {
				return str
			}
		}
		return ""
	}

	// Helper function to safely extract int values
	getInt := func(key string) int {
		if value, exists := connectionMap[key]; exists {
			switch v := value.(type) {
			case int:
				return v
			case float64:
				return int(v)
			}
		}
		return 0
	}

	// Helper function to safely extract bool values
	getBool := func(key string) bool {
		if value, exists := connectionMap[key]; exists {
			if b, ok := value.(bool); ok {
				return b
			}
		}
		return false
	}

	// Extract standard fields
	connection.Type = getString("type")
	connection.Host = getString("host")
	connection.Port = getInt("port")
	connection.User = getString("user")
	connection.Password = getString("password")
	connection.Database = getString("database")
	connection.DbName = getString("dbname") // PostgreSQL specific
	connection.Schema = getString("schema")

	// Extract database-specific fields
	connection.Project = getString("project")
	connection.Dataset = getString("dataset")
	connection.Keyfile = getString("keyfile")
	connection.Account = getString("account")
	connection.Warehouse = getString("warehouse")
	connection.Role = getString("role")
	connection.KeepAlive = getBool("keepalive")
	connection.SearchPath = getString("search_path")
	connection.SSLMode = getString("sslmode")
	connection.Path = getString("path")
	connection.SslDisable = getBool("ssl_disable") // MySQL specific

	// Store any additional fields that weren't mapped
	knownFields := map[string]bool{
		"type": true, "host": true, "port": true, "user": true, "password": true,
		"database": true, "dbname": true, "schema": true, "project": true, "dataset": true,
		"keyfile": true, "account": true, "warehouse": true, "role": true,
		"keepalive": true, "search_path": true, "sslmode": true, "path": true, "ssl_disable": true,
	}

	for key, value := range connectionMap {
		if !knownFields[key] {
			connection.Additional[key] = value
		}
	}

	// Clean up empty Additional map
	if len(connection.Additional) == 0 {
		connection.Additional = nil
	}

	return connection, nil
}

// GetDefaultProfilesPath returns the default path to dbt profiles.yml
func GetDefaultProfilesPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	if runtime.GOOS == "windows" {
		return filepath.Join(homeDir, ".dbt", "profiles.yml")
	}
	return filepath.Join(homeDir, ".dbt", "profiles.yml")
}

// FindProfilesFile searches for profiles.yml in common locations
func FindProfilesFile(projectPath string) (string, error) {
	// Try locations in order of preference
	searchPaths := []string{
		// Current directory
		filepath.Join(projectPath, "profiles.yml"),
		// Project .dbt directory
		filepath.Join(projectPath, ".dbt", "profiles.yml"),
		// User home .dbt directory
		GetDefaultProfilesPath(),
	}

	for _, path := range searchPaths {
		if FileExists(path) {
			return path, nil
		}
	}

	return "", fmt.Errorf("profiles.yml not found in any of the expected locations: %v", searchPaths)
}
