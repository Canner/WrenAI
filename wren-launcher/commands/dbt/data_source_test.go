package dbt

import (
	"testing"
)

// Test constants
const (
	testHost     = "localhost"
	testUser     = "test_user"
	testPassword = "test_pass"
	pgType       = "postgres"
	duckdbType   = "duckdb"
)

// Helper function to validate PostgreSQL data source
func validatePostgresDataSource(t *testing.T, ds *WrenPostgresDataSource, expectedDB string) {
	t.Helper()

	if ds.Host != testHost {
		t.Errorf("Expected host '%s', got '%s'", testHost, ds.Host)
	}
	if ds.Port != "5432" {
		t.Errorf("Expected port 5432, got %s", ds.Port)
	}
	if ds.Database != expectedDB {
		t.Errorf("Expected database '%s', got '%s'", expectedDB, ds.Database)
	}
	if ds.User != testUser {
		t.Errorf("Expected user '%s', got '%s'", testUser, ds.User)
	}
	if ds.Password != testPassword {
		t.Errorf("Expected password '%s', got '%s'", testPassword, ds.Password)
	}

	// Test validation
	if err := ds.Validate(); err != nil {
		t.Errorf("Validation failed: %v", err)
	}

	// Test type
	if ds.GetType() != pgType {
		t.Errorf("Expected type '%s', got '%s'", pgType, ds.GetType())
	}
}

func TestFromDbtProfiles_Postgres(t *testing.T) {
	// Test PostgreSQL connection conversion
	profiles := &DbtProfiles{
		Profiles: map[string]DbtProfile{
			"test_profile": {
				Target: "dev",
				Outputs: map[string]DbtConnection{
					"dev": {
						Type:     pgType,
						Host:     testHost,
						Port:     5432,
						Database: "test_db",
						User:     testUser,
						Password: testPassword,
					},
				},
			},
		},
	}

	dataSources, err := FromDbtProfiles(profiles)
	if err != nil {
		t.Fatalf("FromDbtProfiles failed: %v", err)
	}

	if len(dataSources) != 1 {
		t.Fatalf("Expected 1 data source, got %d", len(dataSources))
	}

	ds, ok := dataSources[0].(*WrenPostgresDataSource)
	if !ok {
		t.Fatalf("Expected WrenPostgresDataSource, got %T", dataSources[0])
	}

	validatePostgresDataSource(t, ds, "test_db")
}

func TestFromDbtProfiles_PostgresWithDbName(t *testing.T) {
	// Test PostgreSQL connection conversion with dbname field (PostgreSQL specific)
	profiles := &DbtProfiles{
		Profiles: map[string]DbtProfile{
			"test_profile": {
				Target: "dev",
				Outputs: map[string]DbtConnection{
					"dev": {
						Type:     "postgres",
						Host:     "localhost",
						Port:     5432,
						DbName:   "jaffle_shop", // Using dbname instead of database
						User:     "test_user",
						Password: "test_pass",
					},
				},
			},
		},
	}

	dataSources, err := FromDbtProfiles(profiles)
	if err != nil {
		t.Fatalf("FromDbtProfiles failed: %v", err)
	}

	if len(dataSources) != 1 {
		t.Fatalf("Expected 1 data source, got %d", len(dataSources))
	}

	ds, ok := dataSources[0].(*WrenPostgresDataSource)
	if !ok {
		t.Fatalf("Expected WrenPostgresDataSource, got %T", dataSources[0])
	}

	if ds.Host != "localhost" {
		t.Errorf("Expected host 'localhost', got '%s'", ds.Host)
	}
	if ds.Port != "5432" {
		t.Errorf("Expected port 5432, got %s", ds.Port)
	}
	if ds.Database != "jaffle_shop" {
		t.Errorf("Expected database 'jaffle_shop', got '%s'", ds.Database)
	}
	if ds.User != "test_user" {
		t.Errorf("Expected user 'test_user', got '%s'", ds.User)
	}
	if ds.Password != "test_pass" {
		t.Errorf("Expected password 'test_pass', got '%s'", ds.Password)
	}

	// Test validation
	if err := ds.Validate(); err != nil {
		t.Errorf("Validation failed: %v", err)
	}

	// Test type
	if ds.GetType() != "postgres" {
		t.Errorf("Expected type 'postgres', got '%s'", ds.GetType())
	}
}

func TestFromDbtProfiles_LocalFile(t *testing.T) {
	// Test local file connection conversion
	profiles := &DbtProfiles{
		Profiles: map[string]DbtProfile{
			"test_profile": {
				Target: "dev",
				Outputs: map[string]DbtConnection{
					"dev": {
						Type: duckdbType,
						Path: "/abs_path/jaffle_shop.duckdb",
					},
				},
			},
		},
	}

	dataSources, err := FromDbtProfiles(profiles)
	if err != nil {
		t.Fatalf("FromDbtProfiles failed: %v", err)
	}

	if len(dataSources) != 1 {
		t.Fatalf("Expected 1 data source, got %d", len(dataSources))
	}

	ds, ok := dataSources[0].(*WrenLocalFileDataSource)
	if !ok {
		t.Fatalf("Expected WrenLocalFileDataSource, got %T", dataSources[0])
	}

	if ds.Url != "/abs_path" {
		t.Errorf("Expected url '/abs_path', got '%s'", ds.Url)
	}
	if ds.Format != duckdbType {
		t.Errorf("Expected format '%s', got '%s'", duckdbType, ds.Format)
	}

	// Test validation
	if err := ds.Validate(); err != nil {
		t.Errorf("Validation failed: %v", err)
	}

	// Test type
	if ds.GetType() != "local_file" {
		t.Errorf("Expected type 'local_file', got '%s'", ds.GetType())
	}
}

func TestFromDbtProfiles_UnsupportedType(t *testing.T) {
	// Test unsupported database type
	profiles := &DbtProfiles{
		Profiles: map[string]DbtProfile{
			"test_profile": {
				Target: "dev",
				Outputs: map[string]DbtConnection{
					"dev": {
						Type: "unsupported_db",
						Host: "localhost",
					},
				},
			},
		},
	}

	dataSources, err := FromDbtProfiles(profiles)
	if err != nil {
		t.Fatalf("FromDbtProfiles failed: %v", err)
	}

	// Unsupported types should be ignored, returning empty list
	if len(dataSources) != 0 {
		t.Fatalf("Expected 0 data sources for unsupported type, got %d", len(dataSources))
	}
}

func TestFromDbtProfiles_NilProfiles(t *testing.T) {
	// Test nil profiles
	_, err := FromDbtProfiles(nil)
	if err == nil {
		t.Fatal("Expected error for nil profiles")
	}
}

// Validator interface for data sources
type Validator interface {
	Validate() error
}

// Helper function to test data source validation
func testDataSourceValidation(t *testing.T, testName string, validDS Validator, invalidDSCases []struct {
	name string
	ds   Validator
}) {
	t.Helper()

	t.Run(testName+" valid", func(t *testing.T) {
		if err := validDS.Validate(); err != nil {
			t.Errorf("Valid data source validation failed: %v", err)
		}
	})

	for _, tt := range invalidDSCases {
		t.Run(testName+" "+tt.name, func(t *testing.T) {
			if err := tt.ds.Validate(); err == nil {
				t.Errorf("Expected validation error for %s, but got none", tt.name)
			}
		})
	}
}

func TestPostgresDataSourceValidation(t *testing.T) {
	validDS := &WrenPostgresDataSource{
		Host:     testHost,
		Port:     "5432",
		Database: "test",
		User:     "user",
	}

	invalidCases := []struct {
		name string
		ds   Validator
	}{
		{
			"empty host",
			&WrenPostgresDataSource{
				Port:     "5432",
				Database: "test",
				User:     "user",
			},
		},
		{
			"empty database",
			&WrenPostgresDataSource{
				Host: testHost,
				Port: "5432",
				User: "user",
			},
		},
		{
			"invalid port",
			&WrenPostgresDataSource{
				Host:     testHost,
				Port:     "0",
				Database: "test",
				User:     "user",
			},
		},
	}

	testDataSourceValidation(t, "postgres", validDS, invalidCases)
}

func TestMysqlDataSourceValidation(t *testing.T) {
	// Test MySQL data source validation
	tests := []struct {
		name    string
		ds      *WrenMysqlDataSource
		wantErr bool
	}{
		{
			name: "valid",
			ds: &WrenMysqlDataSource{
				Host:     "localhost",
				Port:     "3306",
				Database: "test",
				User:     "user",
			},
			wantErr: false,
		},
		{
			name: "empty host",
			ds: &WrenMysqlDataSource{
				Port:     "3306",
				Database: "test",
				User:     "user",
			},
			wantErr: true,
		},
		{
			name: "empty database",
			ds: &WrenMysqlDataSource{
				Host: "localhost",
				Port: "3306",
				User: "user",
			},
			wantErr: true,
		},
		{
			name: "invalid port",
			ds: &WrenMysqlDataSource{
				Host:     "localhost",
				Port:     "",
				Database: "test",
				User:     "user",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.ds.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestGetActiveDataSources(t *testing.T) {
	profiles := &DbtProfiles{
		Profiles: map[string]DbtProfile{
			"project1": {
				Target: "dev",
				Outputs: map[string]DbtConnection{
					"dev": {
						Type:     "postgres",
						Host:     "localhost",
						Port:     5432,
						Database: "dev_db",
						User:     "dev_user",
					},
					"prod": {
						Type:     "postgres",
						Host:     "prod-host",
						Port:     5432,
						Database: "prod_db",
						User:     "prod_user",
					},
				},
			},
		},
	}

	// Test getting default target
	dataSources, err := GetActiveDataSources(profiles, "", "project1", "")
	if err != nil {
		t.Fatalf("GetActiveDataSources failed: %v", err)
	}
	if len(dataSources) != 1 {
		t.Fatalf("Expected 1 data source, got %d", len(dataSources))
	}

	ds := dataSources[0].(*WrenPostgresDataSource)
	if ds.Database != "dev_db" {
		t.Errorf("Expected dev database, got %s", ds.Database)
	}

	// Test specified target
	dataSources, err = GetActiveDataSources(profiles, "", "project1", "prod")
	if err != nil {
		t.Fatalf("GetActiveDataSources failed: %v", err)
	}
	if len(dataSources) != 1 {
		t.Fatalf("Expected 1 data source, got %d", len(dataSources))
	}

	ds = dataSources[0].(*WrenPostgresDataSource)
	if ds.Database != "prod_db" {
		t.Errorf("Expected prod database, got %s", ds.Database)
	}

	// Test nonexistent profile
	_, err = GetActiveDataSources(profiles, "", "nonexistent", "")
	if err == nil {
		t.Error("Expected error for nonexistent profile")
	}

	// Test nonexistent target
	_, err = GetActiveDataSources(profiles, "", "project1", "nonexistent")
	if err == nil {
		t.Error("Expected error for nonexistent target")
	}
}

func TestGetDataSourceByType(t *testing.T) {
	profiles := &DbtProfiles{
		Profiles: map[string]DbtProfile{
			"mixed_project": {
				Target: "dev",
				Outputs: map[string]DbtConnection{
					"postgres_dev": {
						Type:     "postgres",
						Host:     "localhost",
						Port:     5432,
						Database: "dev_db",
						User:     "user",
					},
					"file_dev": {
						Type: duckdbType,
						Path: "/data/test.csv",
					},
					"postgres_prod": {
						Type:     "postgres",
						Host:     "prod-host",
						Port:     5432,
						Database: "prod_db",
						User:     "user",
					},
				},
			},
		},
	}

	// Test getting postgres type
	postgresSources, err := GetDataSourceByType(profiles, "postgres")
	if err != nil {
		t.Fatalf("GetDataSourceByType failed: %v", err)
	}
	if len(postgresSources) != 2 {
		t.Fatalf("Expected 2 postgres data sources, got %d", len(postgresSources))
	}

	// Test getting local_file type
	fileSources, err := GetDataSourceByType(profiles, "local_file")
	if err != nil {
		t.Fatalf("GetDataSourceByType failed: %v", err)
	}
	if len(fileSources) != 1 {
		t.Fatalf("Expected 1 file data source, got %d", len(fileSources))
	}

	// Test getting nonexistent type
	nonexistentSources, err := GetDataSourceByType(profiles, "nonexistent")
	if err != nil {
		t.Fatalf("GetDataSourceByType failed: %v", err)
	}
	if len(nonexistentSources) != 0 {
		t.Fatalf("Expected 0 nonexistent data sources, got %d", len(nonexistentSources))
	}
}

func TestValidateAllDataSources(t *testing.T) {
	// Test valid profiles
	validProfiles := &DbtProfiles{
		Profiles: map[string]DbtProfile{
			"valid_project": {
				Target: "dev",
				Outputs: map[string]DbtConnection{
					"dev": {
						Type:     "postgres",
						Host:     "localhost",
						Port:     5432,
						Database: "test_db",
						User:     "user",
					},
				},
			},
		},
	}

	err := ValidateAllDataSources(validProfiles)
	if err != nil {
		t.Errorf("ValidateAllDataSources failed for valid profiles: %v", err)
	}

	// Test invalid profiles
	invalidProfiles := &DbtProfiles{
		Profiles: map[string]DbtProfile{
			"invalid_project": {
				Target: "dev",
				Outputs: map[string]DbtConnection{
					"dev": {
						Type: "postgres",
						Host: "localhost",
						// Missing required fields
					},
				},
			},
		},
	}

	err = ValidateAllDataSources(invalidProfiles)
	if err == nil {
		t.Error("ValidateAllDataSources should fail for invalid profiles")
	}
}
