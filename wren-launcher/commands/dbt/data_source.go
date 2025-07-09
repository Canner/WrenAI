package dbt

import (
	"fmt"
	"path/filepath"
	"strings"
)

// DataSource is a common interface for all data source types
type DataSource interface {
	GetType() string
	Validate() error
	MapType(sourceType string) string
}

// FromDbtProfiles converts DBT profiles to DataSources
// Returns a DataSource slice since a profile may contain multiple outputs
func FromDbtProfiles(profiles *DbtProfiles) ([]DataSource, error) {
	if profiles == nil {
		return nil, fmt.Errorf("profiles cannot be nil")
	}

	var dataSources []DataSource

	// Iterate through all profiles
	for profileName, profile := range profiles.Profiles {
		// Iterate through each profile's outputs
		for outputName, connection := range profile.Outputs {
			dataSource, err := convertConnectionToDataSource(connection, "", profileName, outputName)
			if err != nil {
				return nil, fmt.Errorf("failed to convert connection %s.%s: %w", profileName, outputName, err)
			}
			if dataSource != nil {
				dataSources = append(dataSources, dataSource)
			}
		}
	}

	return dataSources, nil
}

// convertConnectionToDataSource converts connection to corresponding DataSource based on connection type
func convertConnectionToDataSource(conn DbtConnection, dbtHomePath, profileName, outputName string) (DataSource, error) {
	switch strings.ToLower(conn.Type) {
	case "postgres", "postgresql":
		return convertToPostgresDataSource(conn)
	case "duckdb":
		return convertToLocalFileDataSource(conn, dbtHomePath)
	default:
		// For unsupported database types, we can choose to ignore or return error
		// Here we choose to return nil and log a warning
		fmt.Printf("Warning: Unsupported database type '%s' for %s.%s\n", conn.Type, profileName, outputName)
		return nil, nil
	}
}

// convertToPostgresDataSource converts to PostgreSQL data source
func convertToPostgresDataSource(conn DbtConnection) (*WrenPostgresDataSource, error) {
	ds := &WrenPostgresDataSource{
		Host:     conn.Host,
		Port:     conn.Port,
		Database: conn.Database,
		User:     conn.User,
		Password: conn.Password,
	}

	// If no port is specified, use PostgreSQL default port
	if ds.Port == 0 {
		ds.Port = 5432
	}

	return ds, nil
}

// convertToLocalFileDataSource converts to local file data source
func convertToLocalFileDataSource(conn DbtConnection, dbtHome string) (*WrenLocalFileDataSource, error) {
	// For file types, we need to get URL and format info from Additional fields
	// or use some conventional field names

	var url, format string

	// Try to get file path from different fields
	if conn.Path != "" {
		if filepath.IsAbs(conn.Path) {
			url = filepath.Dir(conn.Path)
		} else {
			relativeDir := filepath.Dir(conn.Path)
			if dbtHome != "" {
				url = filepath.Join(dbtHome, relativeDir)
			} else {
				url = relativeDir
			}
		}
	} else if file, exists := conn.Additional["file"]; exists {
		if fileStr, ok := file.(string); ok {
			if filepath.IsAbs(fileStr) {
				url = filepath.Dir(fileStr)
			} else {
				relativeDir := filepath.Dir(fileStr)
				if dbtHome != "" {
					url = filepath.Join(dbtHome, relativeDir)
				} else {
					url = relativeDir
				}
			}
		}
	}

	// Try to get format information
	format = "duckdb" // Default to duckdb if not specified

	if url == "" {
		return nil, fmt.Errorf("file path not found in connection configuration")
	}

	return &WrenLocalFileDataSource{
		Url:    url,
		Format: format,
	}, nil
}

type WrenLocalFileDataSource struct {
	Url    string `json:"url"`
	Format string `json:"format"`
}

// GetType implements DataSource interface
func (ds *WrenLocalFileDataSource) GetType() string {
	return "local_file"
}

// Validate implements DataSource interface
func (ds *WrenLocalFileDataSource) Validate() error {
	if ds.Url == "" {
		return fmt.Errorf("file URL cannot be empty")
	}
	if ds.Format == "" {
		return fmt.Errorf("file format cannot be empty")
	}
	return nil
}

func (ds *WrenLocalFileDataSource) MapType(sourceType string) string {
	// Convert to uppercase for consistent mapping
	sourceType = strings.ToUpper(sourceType)

	switch sourceType {
	case "INTEGER", "INT", "BIGINT":
		return "integer"
	case "VARCHAR", "TEXT", "STRING":
		return "varchar"
	case "DATE":
		return "date"
	case "TIMESTAMP", "DATETIME":
		return "timestamp"
	case "DOUBLE", "FLOAT", "NUMERIC", "DECIMAL":
		return "double"
	case "BOOLEAN", "BOOL":
		return "boolean"
	default:
		// Return the original type if no mapping is found
		return strings.ToLower(sourceType)
	}
}

type WrenPostgresDataSource struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
}

// GetType implements DataSource interface
func (ds *WrenPostgresDataSource) GetType() string {
	return "postgres"
}

// Validate implements DataSource interface
func (ds *WrenPostgresDataSource) Validate() error {
	if ds.Host == "" {
		return fmt.Errorf("host cannot be empty")
	}
	if ds.Database == "" {
		return fmt.Errorf("database cannot be empty")
	}
	if ds.User == "" {
		return fmt.Errorf("user cannot be empty")
	}
	if ds.Port <= 0 || ds.Port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	return nil
}

func (ds *WrenPostgresDataSource) MapType(sourceType string) string {
	// This method is not used in WrenPostgresDataSource, but required by DataSource interface
	return sourceType
}

// GetActiveDataSources gets active data sources based on specified profile and target
// If profileName is empty, it will use the first found profile
// If targetName is empty, it will use the profile's default target
func GetActiveDataSources(profiles *DbtProfiles, dbtHomePath, profileName, targetName string) ([]DataSource, error) {
	if profiles == nil {
		return nil, fmt.Errorf("profiles cannot be nil")
	}

	// If no profile is specified, use the first one
	if profileName == "" {
		for name := range profiles.Profiles {
			profileName = name
			break
		}
	}

	profile, exists := profiles.Profiles[profileName]
	if !exists {
		return nil, fmt.Errorf("profile '%s' not found", profileName)
	}

	// If no target is specified, use the default one
	if targetName == "" {
		targetName = profile.Target
	}

	connection, exists := profile.Outputs[targetName]
	if !exists {
		return nil, fmt.Errorf("target '%s' not found in profile '%s'", targetName, profileName)
	}

	dataSource, err := convertConnectionToDataSource(connection, dbtHomePath, profileName, targetName)
	if err != nil {
		return nil, fmt.Errorf("failed to convert connection %s.%s: %w", profileName, targetName, err)
	}

	if dataSource == nil {
		return []DataSource{}, nil
	}

	return []DataSource{dataSource}, nil
}

// GetDataSourceByType gets all data sources of specified type from profiles
func GetDataSourceByType(profiles *DbtProfiles, dsType string) ([]DataSource, error) {
	dataSources, err := FromDbtProfiles(profiles)
	if err != nil {
		return nil, err
	}

	var filtered []DataSource
	for _, ds := range dataSources {
		if ds.GetType() == dsType {
			filtered = append(filtered, ds)
		}
	}

	return filtered, nil
}

// ValidateAllDataSources validates all converted data sources
func ValidateAllDataSources(profiles *DbtProfiles) error {
	dataSources, err := FromDbtProfiles(profiles)
	if err != nil {
		return err
	}

	var errors []error
	for i, ds := range dataSources {
		if err := ds.Validate(); err != nil {
			errors = append(errors, fmt.Errorf("data source %d (%s): %w", i, ds.GetType(), err))
		}
	}

	if len(errors) > 0 {
		var errorMsg string
		for _, err := range errors {
			errorMsg += err.Error() + "; "
		}
		return fmt.Errorf("validation errors: %s", errorMsg)
	}

	return nil
}

// DefaultDataSource is a default data source when no profiles.yml is found
type DefaultDataSource struct{}

// GetType implements DataSource interface
func (d *DefaultDataSource) GetType() string {
	return "default"
}

// Validate implements DataSource interface
func (d *DefaultDataSource) Validate() error {
	return nil
}

func (d *DefaultDataSource) MapType(sourceType string) string {
	// Default type mapping
	switch strings.ToLower(sourceType) {
	case "integer", "int", "bigint", "int64":
		return "integer"
	case "varchar", "text", "string", "char":
		return "string"
	case "timestamp", "datetime", "date":
		return "timestamp"
	case "double", "float", "decimal", "numeric":
		return "double"
	case "boolean", "bool":
		return "boolean"
	default:
		return "string"
	}
}
