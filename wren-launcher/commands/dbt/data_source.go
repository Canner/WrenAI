package dbt

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pterm/pterm"
)

// Constants for data types
const (
	integerType     = "integer"
	smallintType    = "smallint"
	bigintType      = "bigint"
	floatType       = "float"
	decimalType     = "decimal"
	varcharType     = "varchar"
	charType        = "char"
	textType        = "text"
	dateType        = "date"
	timestampType   = "timestamp"
	timestamptzType = "timestamptz"
	doubleType      = "double"
	booleanType     = "boolean"
	jsonType        = "json"
	intervalType    = "interval"
	postgresType    = "postgres"
)

// Constants for SQL data types
const (
	integerSQL   = "INTEGER"
	intSQL       = "INT"
	bigintSQL    = "BIGINT"
	varcharSQL   = "VARCHAR"
	textSQL      = "TEXT"
	stringSQL    = "STRING"
	dateSQL      = "DATE"
	timestampSQL = "TIMESTAMP"
	datetimeSQL  = "DATETIME"
	doubleSQL    = "DOUBLE"
	floatSQL     = "FLOAT"
	numericSQL   = "NUMERIC"
	decimalSQL   = "DECIMAL"
	booleanSQL   = "BOOLEAN"
	boolSQL      = "BOOL"
	jsonSQL      = "JSON"
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
	case postgresType, "postgresql":
		return convertToPostgresDataSource(conn)
	case "duckdb":
		return convertToLocalFileDataSource(conn, dbtHomePath)
	case "sqlserver":
		return convertToMSSQLDataSource(conn)
	case "mysql":
		return convertToMysqlDataSource(conn)
	case "bigquery":
		// Pass the dbtHomePath to the BigQuery converter
		return convertToBigQueryDataSource(conn, dbtHomePath)
	default:
		// For unsupported database types, we can choose to ignore or return error
		// Here we choose to return nil and log a warning
		pterm.Warning.Printf("Unsupported database type '%s' for %s.%s\n", conn.Type, profileName, outputName)
		return nil, nil
	}
}

// convertToPostgresDataSource converts to PostgreSQL data source
func convertToPostgresDataSource(conn DbtConnection) (*WrenPostgresDataSource, error) {
	// For PostgreSQL, prefer dbname over database field
	dbName := conn.DbName
	if dbName == "" {
		dbName = conn.Database
	}

	pterm.Info.Printf("Converting Postgres data source: %s:%d/%s\n", conn.Host, conn.Port, dbName)
	port := strconv.Itoa(conn.Port)
	if conn.Port == 0 {
		port = "5432"
	}

	ds := &WrenPostgresDataSource{
		Host:     conn.Host,
		Port:     port,
		Database: dbName,
		User:     conn.User,
		Password: conn.Password,
	}

	return ds, nil
}

func convertToMSSQLDataSource(conn DbtConnection) (*WrenMSSQLDataSource, error) {
	port := strconv.Itoa(conn.Port)
	if conn.Port == 0 {
		port = "1433"
	}

	ds := &WrenMSSQLDataSource{
		Database:   conn.Database,
		Host:       conn.Server,
		Port:       port,
		User:       conn.User,
		Password:   conn.Password,
		TdsVersion: "8.0",                           // the default tds version for Wren engine image
		Driver:     "ODBC Driver 18 for SQL Server", // the driver used by Wren engine image
		Kwargs:     map[string]interface{}{"TrustServerCertificate": "YES"},
	}

	return ds, nil
}

// convertToLocalFileDataSource converts to local file data source
func convertToLocalFileDataSource(conn DbtConnection, dbtHome string) (*WrenLocalFileDataSource, error) {
	// For file types, we need to get URL and format info from Additional fields
	// or use some conventional field names

	resolvePath := func(path string) string {
		if filepath.IsAbs(path) {
			return filepath.Dir(path)
		}
		relativeDir := filepath.Dir(path)
		if dbtHome != "" {
			return filepath.Join(dbtHome, relativeDir)
		}
		return relativeDir
	}

	var url, format string

	// Try to get file path from different fields
	if conn.Path != "" {
		url = resolvePath(conn.Path)
	} else if file, exists := conn.Additional["file"]; exists {
		if fileStr, ok := file.(string); ok {
			url = resolvePath(fileStr)
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

func convertToMysqlDataSource(conn DbtConnection) (*WrenMysqlDataSource, error) {
	pterm.Info.Printf("Converting MySQL data source: %s:%d/%s\n", conn.Host, conn.Port, conn.Database)

	sslMode := "ENABLED" // Default SSL mode
	if conn.SslDisable {
		sslMode = "DISABLED"
	}
	port := strconv.Itoa(conn.Port)
	if conn.Port == 0 {
		port = "3306"
	}

	ds := &WrenMysqlDataSource{
		Host:     conn.Host,
		Port:     port,
		Database: conn.Database,
		User:     conn.User,
		Password: conn.Password,
		SslMode:  sslMode,
	}

	return ds, nil
}

// convertToBigQueryDataSource converts to BigQuery data source
func convertToBigQueryDataSource(conn DbtConnection, dbtHomePath string) (*WrenBigQueryDataSource, error) {
	method := strings.ToLower(strings.TrimSpace(conn.Method))
	var credentials string

	// Helper: validate JSON and base64 encode
	encodeJSON := func(b []byte) (string, error) {
		var js map[string]interface{}
		if err := json.Unmarshal(b, &js); err != nil {
			return "", fmt.Errorf("service account JSON is invalid: %w", err)
		}
		return base64.StdEncoding.EncodeToString(b), nil
	}

	switch method {
	case "service-account-json":
		// Extract inline JSON from Additional["keyfile_json"]
		var keyfileJSON string
		if kfj, exists := conn.Additional["keyfile_json"]; exists {
			if kfjStr, ok := kfj.(string); ok {
				keyfileJSON = kfjStr
			}
		}
		if keyfileJSON == "" {
			return nil, fmt.Errorf("bigquery: method 'service-account-json' requires 'keyfile_json'")
		}
		enc, err := encodeJSON([]byte(keyfileJSON))
		if err != nil {
			return nil, err
		}
		credentials = enc
	case "service-account", "":
		// Prefer structured field; fall back to Additional["keyfile"]
		keyfilePath := strings.TrimSpace(conn.Keyfile)
		if keyfilePath == "" {
			if kf, ok := conn.Additional["keyfile"]; ok {
				if kfStr, ok := kf.(string); ok {
					keyfilePath = strings.TrimSpace(kfStr)
				}
			}
		}
		if keyfilePath == "" {
			// If method was omitted (""), try as a fallback to inline json
			if kfj, ok := conn.Additional["keyfile_json"]; ok {
				if kfjStr, ok := kfj.(string); ok && kfjStr != "" {
					enc, err := encodeJSON([]byte(kfjStr))
					if err != nil {
						return nil, err
					}
					credentials = enc
				}
			}
			if credentials == "" {
				return nil, fmt.Errorf("bigquery: method 'service-account' requires 'keyfile' path")
			}
		} else {
			// If keyfile path is not absolute, join it
			// with the dbt project's home directory path.
			resolvedKeyfilePath := keyfilePath
			if !filepath.IsAbs(keyfilePath) && dbtHomePath != "" {
				resolvedKeyfilePath = filepath.Join(dbtHomePath, keyfilePath)
			}

			cleanPath := filepath.Clean(resolvedKeyfilePath)
			b, err := os.ReadFile(cleanPath)
			if err != nil {
				// Update the error message to show the path that was attempted
				return nil, fmt.Errorf("failed to read keyfile '%s': %w", cleanPath, err)
			}
			enc, err := encodeJSON(b)
			if err != nil {
				return nil, err
			}
			credentials = enc
		}
	case "oauth":
		pterm.Warning.Println("bigquery: oauth auth method is not supported; skipping data source")
		return nil, nil
	default:
		pterm.Warning.Printf("bigquery: unsupported auth method '%s'; supported: service-account, service-account-json\n", method)
		return nil, nil
	}

	ds := &WrenBigQueryDataSource{
		Project:     conn.Project,
		Dataset:     conn.Dataset,
		Credentials: credentials,
	}
	return ds, nil
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
	case integerSQL, intSQL, bigintSQL:
		return integerType
	case varcharSQL, textSQL, stringSQL:
		return varcharType
	case dateSQL:
		return dateType
	case timestampSQL, datetimeSQL:
		return timestampType
	case doubleSQL, floatSQL, numericSQL, decimalSQL:
		return doubleType
	case booleanSQL, boolSQL:
		return booleanType
	default:
		// Return the original type if no mapping is found
		return strings.ToLower(sourceType)
	}
}

type WrenPostgresDataSource struct {
	Host     string `json:"host"`
	Port     string `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
}

// GetType implements DataSource interface
func (ds *WrenPostgresDataSource) GetType() string {
	return postgresType
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
	if ds.Port == "" {
		return fmt.Errorf("port must be specified")
	}
	port, err := strconv.Atoi(ds.Port)
	if err != nil {
		return fmt.Errorf("port must be a valid number")
	}
	if port <= 0 || port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	return nil
}

func (ds *WrenPostgresDataSource) MapType(sourceType string) string {
	// This method is not used in WrenPostgresDataSource, but required by DataSource interface
	return sourceType
}

type WrenMSSQLDataSource struct {
	Database   string                 `json:"database"`
	Host       string                 `json:"host"`
	Port       string                 `json:"port"`
	User       string                 `json:"user"`
	Password   string                 `json:"password"`
	TdsVersion string                 `json:"tds_version"`
	Driver     string                 `json:"driver"`
	Kwargs     map[string]interface{} `json:"kwargs"`
}

func (ds *WrenMSSQLDataSource) GetType() string {
	return "mssql"
}

func (ds *WrenMSSQLDataSource) Validate() error {
	if ds.Host == "" {
		return fmt.Errorf("host cannot be empty")
	}
	if ds.Database == "" {
		return fmt.Errorf("database cannot be empty")
	}
	if ds.User == "" {
		return fmt.Errorf("user cannot be empty")
	}
	if ds.Port == "" {
		return fmt.Errorf("port must be specified")
	}
	port, err := strconv.Atoi(ds.Port)
	if err != nil {
		return fmt.Errorf("port must be a valid number")
	}
	if port <= 0 || port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	if ds.Password == "" {
		return fmt.Errorf("password cannot be empty")
	}
	return nil
}

func (ds *WrenMSSQLDataSource) MapType(sourceType string) string {
	// This method is not used in WrenMSSQLDataSource, but required by DataSource interface
	switch strings.ToLower(sourceType) {
	case charType, "nchar":
		return charType
	case varcharType, "nvarchar":
		return varcharType
	case textType, "ntext":
		return textType
	case "bit", "tinyint":
		return booleanType
	case "smallint":
		return smallintType
	case "int":
		return integerType
	case "bigint":
		return bigintType
	case booleanType:
		return booleanType
	case "float", "real":
		return floatType
	case "decimal", "numeric", "money", "smallmoney":
		return decimalType
	case "date":
		return dateType
	case "datetime", "datetime2", "smalldatetime":
		return timestampType
	case "time":
		return intervalType
	case "datetimeoffset":
		return timestamptzType
	case "json":
		return jsonType
	default:
		return strings.ToLower(sourceType)
	}
}

type WrenMysqlDataSource struct {
	Database string `json:"database"`
	Host     string `json:"host"`
	Password string `json:"password"`
	Port     string `json:"port"`
	User     string `json:"user"`
	SslCA    string `json:"ssl_ca,omitempty"`   // Optional SSL CA file for MySQL
	SslMode  string `json:"ssl_mode,omitempty"` // Optional SSL mode for MySQL
}

// GetType implements DataSource interface
func (ds *WrenMysqlDataSource) GetType() string {
	return "mysql"
}

// Validate implements DataSource interface
func (ds *WrenMysqlDataSource) Validate() error {
	if ds.Host == "" {
		return fmt.Errorf("host cannot be empty")
	}
	if ds.Database == "" {
		return fmt.Errorf("database cannot be empty")
	}
	if ds.User == "" {
		return fmt.Errorf("user cannot be empty")
	}
	if ds.Port == "" {
		return fmt.Errorf("port must be specified")
	}
	port, err := strconv.Atoi(ds.Port)
	if err != nil {
		return fmt.Errorf("port must be a valid number")
	}
	if port <= 0 || port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	return nil
}

func (ds *WrenMysqlDataSource) MapType(sourceType string) string {
	// This method is not used in WrenMysqlDataSource, but required by DataSource interface
	sourceType = strings.ToUpper(sourceType)
	switch sourceType {
	case "CHAR":
		return "char"
	case "VARCHAR":
		return varcharType
	case "TEXT", "TINYTEXT", "MEDIUMTEXT", "LONGTEXT", "ENUM", "SET":
		return "text"
	case "BIT", "TINYINT":
		return "TINYINT"
	case "SMALLINT":
		return "SMALLINT"
	case "MEDIUMINT", "INT", integerSQL:
		return "INTEGER"
	case "BIGINT":
		return "BIGINT"
	case "FLOAT", "DOUBLE":
		return "DOUBLE"
	case decimalSQL, "NUMERIC":
		return decimalSQL
	case dateSQL:
		return dateSQL
	case datetimeSQL:
		return datetimeSQL
	case "TIMESTAMP":
		return "TIMESTAMPTZ"
	case booleanSQL, "BOOL":
		return booleanSQL
	case jsonSQL:
		return jsonSQL
	default:
		// Return the original type if no mapping is found
		return strings.ToLower(sourceType)
	}
}

type WrenBigQueryDataSource struct {
	Project     string `json:"project_id"`
	Dataset     string `json:"dataset_id"`
	Credentials string `json:"credentials"`
}

// GetType implements DataSource interface
func (ds *WrenBigQueryDataSource) GetType() string {
	return "bigquery"
}

// Validate implements DataSource interface
func (ds *WrenBigQueryDataSource) Validate() error {
	if strings.TrimSpace(ds.Project) == "" {
		return fmt.Errorf("project_id cannot be empty")
	}
	if strings.TrimSpace(ds.Dataset) == "" {
		return fmt.Errorf("dataset_id cannot be empty")
	}
	if strings.TrimSpace(ds.Credentials) == "" {
		return fmt.Errorf("credentials cannot be empty")
	}
	return nil
}

// MapType implements DataSource interface
func (ds *WrenBigQueryDataSource) MapType(sourceType string) string {
	switch strings.ToUpper(sourceType) {
	case "INT64", "INTEGER":
		return integerType
	case "FLOAT64", "FLOAT":
		return doubleType
	case "STRING":
		return varcharType
	case "BOOL", "BOOLEAN":
		return booleanType
	case "DATE":
		return dateType
	case "TIMESTAMP", "DATETIME":
		return timestampType
	case "NUMERIC", "DECIMAL", "BIGNUMERIC":
		return doubleType
	case "BYTES":
		return varcharType
	case "JSON":
		return varcharType
	default:
		return strings.ToLower(sourceType)
	}
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
		return varcharType
	case "timestamp", "datetime", "date":
		return "timestamp"
	case "double", "float", "decimal", "numeric":
		return "double"
	case "boolean", "bool":
		return "boolean"
	default:
		return strings.ToLower(sourceType)
	}
}
