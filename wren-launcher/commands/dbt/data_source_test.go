package dbt

import (
	"encoding/base64"
	"os"
	"path/filepath"
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

func TestFromDbtProfiles_PostgresWithDefaultPort(t *testing.T) {
	// Test PostgreSQL connection conversion when port is not specified
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

	if filepath.ToSlash(ds.Url) != "/abs_path" {
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

func TestFromDbtProfiles_BigQuery(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "test-dbt-home")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.RemoveAll(tempDir); err != nil {
			t.Logf("Failed to remove temporary directory %s: %v", tempDir, err)
		}
	}()

	t.Run("service-account-json", func(t *testing.T) {
		keyfileContent := `{"type": "service_account", "project_id": "test-project", "private_key_id": "test-key-id", "private_key": "test-private-key", "client_email": "test-client-email", "client_id": "test-client-id", "auth_uri": "test-auth-uri", "token_uri": "test-token-uri", "auth_provider_x509_cert_url": "test-cert-url", "client_x509_cert_url": "test-client-cert-url"}` // #nosec G101
		profiles := &DbtProfiles{
			Profiles: map[string]DbtProfile{
				"test_profile": {
					Target: "dev",
					Outputs: map[string]DbtConnection{
						"dev": {
							Type:    "bigquery",
							Method:  "service-account-json",
							Project: "test-project",
							Dataset: "test-dataset",
							Additional: map[string]interface{}{
								"keyfile_json": keyfileContent,
							},
						},
					},
				},
			},
		}

		dataSources, err := GetActiveDataSources(profiles, "", "test_profile", "dev")
		if err != nil {
			t.Fatalf("GetActiveDataSources failed: %v", err)
		}

		if len(dataSources) != 1 {
			t.Fatalf("Expected 1 data source, got %d", len(dataSources))
		}

		ds, ok := dataSources[0].(*WrenBigQueryDataSource)
		if !ok {
			t.Fatalf("Expected WrenBigQueryDataSource, got %T", dataSources[0])
		}

		if ds.Project != "test-project" {
			t.Errorf("Expected project 'test-project', got '%s'", ds.Project)
		}

		if ds.Dataset != "test-dataset" {
			t.Errorf("Expected dataset 'test-dataset', got '%s'", ds.Dataset)
		}

		encodedContent, _ := base64.StdEncoding.DecodeString(ds.Credentials)
		if string(encodedContent) != keyfileContent {
			t.Errorf("Expected base64-encoded keyfile JSON content, got different content")
		}
	})

	t.Run("service-account-with-absolute-keyfile-path", func(t *testing.T) {
		keyfileContent := `{"type": "service_account"}` // #nosec G101
		keyfilePath := filepath.Join(tempDir, "keyfile.json")
		if err := os.WriteFile(keyfilePath, []byte(keyfileContent), 0600); err != nil {
			t.Fatal(err)
		}

		profiles := &DbtProfiles{
			Profiles: map[string]DbtProfile{
				"test_profile": {
					Target: "dev",
					Outputs: map[string]DbtConnection{
						"dev": {
							Type:    "bigquery",
							Method:  "service-account",
							Project: "test-project",
							Dataset: "test-dataset",
							Keyfile: keyfilePath,
						},
					},
				},
			},
		}

		dataSources, err := GetActiveDataSources(profiles, "", "test_profile", "dev")
		if err != nil {
			t.Fatalf("GetActiveDataSources failed: %v", err)
		}

		if len(dataSources) != 1 {
			t.Fatalf("Expected 1 data source, got %d", len(dataSources))
		}

		ds, ok := dataSources[0].(*WrenBigQueryDataSource)
		if !ok {
			t.Fatalf("Expected WrenBigQueryDataSource, got %T", dataSources[0])
		}

		encodedContent, _ := base64.StdEncoding.DecodeString(ds.Credentials)
		if string(encodedContent) != keyfileContent {
			t.Errorf("Expected base64-encoded keyfile content, got different content")
		}
	})

	t.Run("service-account-with-relative-keyfile-path", func(t *testing.T) {
		dbtHomePath := tempDir
		keyfileContent := `{"type": "service_account"}` // #nosec G101
		keyfilePath := "keys/keyfile.json"
		fullKeyfilePath := filepath.Join(dbtHomePath, keyfilePath)

		if err := os.MkdirAll(filepath.Dir(fullKeyfilePath), 0750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fullKeyfilePath, []byte(keyfileContent), 0600); err != nil {
			t.Fatal(err)
		}

		profiles := &DbtProfiles{
			Profiles: map[string]DbtProfile{
				"test_profile": {
					Target: "dev",
					Outputs: map[string]DbtConnection{
						"dev": {
							Type:    "bigquery",
							Method:  "service-account",
							Project: "test-project",
							Dataset: "test-dataset",
							Keyfile: keyfilePath,
						},
					},
				},
			},
		}

		dataSources, err := GetActiveDataSources(profiles, dbtHomePath, "test_profile", "dev")
		if err != nil {
			t.Fatalf("GetActiveDataSources failed: %v", err)
		}

		if len(dataSources) != 1 {
			t.Fatalf("Expected 1 data source, got %d", len(dataSources))
		}

		ds, ok := dataSources[0].(*WrenBigQueryDataSource)
		if !ok {
			t.Fatalf("Expected WrenBigQueryDataSource, got %T", dataSources[0])
		}

		encodedContent, _ := base64.StdEncoding.DecodeString(ds.Credentials)
		if string(encodedContent) != keyfileContent {
			t.Errorf("Expected base64-encoded keyfile content, got different content")
		}
	})
}

func TestBigQueryDataSourceValidation(t *testing.T) {
	tests := []struct {
		name    string
		ds      *WrenBigQueryDataSource
		wantErr bool
	}{
		{
			name: "valid",
			ds: &WrenBigQueryDataSource{
				Project:     "test-project",
				Dataset:     "test-dataset",
				Credentials: "dGVzdC1jcmVkZW50aWFscw==", // "test-credentials"
			},
			wantErr: false,
		},
		{
			name: "invalid - missing project",
			ds: &WrenBigQueryDataSource{
				Project:     "",
				Dataset:     "test-dataset",
				Credentials: "dGVzdC1jcmVkZW50aWFscw==",
			},
			wantErr: true,
		},
		{
			name: "invalid - missing dataset",
			ds: &WrenBigQueryDataSource{
				Project:     "test-project",
				Dataset:     "",
				Credentials: "dGVzdC1jcmVkZW50aWFscw==",
			},
			wantErr: true,
		},
		{
			name: "invalid - missing credentials",
			ds: &WrenBigQueryDataSource{
				Project:     "test-project",
				Dataset:     "test-dataset",
				Credentials: "",
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

func TestMapType(t *testing.T) {
	tests := []struct {
		name       string
		dataSource DataSource
		sourceType string
		want       string
	}{
		{
			name:       "BigQuery INT64 to integer",
			dataSource: &WrenBigQueryDataSource{},
			sourceType: "INT64",
			want:       "integer",
		},
		{
			name:       "BigQuery STRING to varchar",
			dataSource: &WrenBigQueryDataSource{},
			sourceType: "STRING",
			want:       "varchar",
		},
		{
			name:       "LocalFile INTEGER to integer",
			dataSource: &WrenLocalFileDataSource{},
			sourceType: "INTEGER",
			want:       "integer",
		},
		{
			name:       "LocalFile VARCHAR to varchar",
			dataSource: &WrenLocalFileDataSource{},
			sourceType: "VARCHAR",
			want:       "varchar",
		},
		{
			name:       "DefaultDataSource int to integer",
			dataSource: &DefaultDataSource{},
			sourceType: "int",
			want:       "integer",
		},
		{
			name:       "PostgresDataSource (no mapping)",
			dataSource: &WrenPostgresDataSource{},
			sourceType: "unknown_type",
			want:       "unknown_type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.dataSource.MapType(tt.sourceType)
			if got != tt.want {
				t.Errorf("MapType(%s) = %s; want %s", tt.sourceType, got, tt.want)
			}
		})
	}
}
