package dbt

// DbtProfiles represents the structure of dbt profiles.yml
type DbtProfiles struct {
	Config   map[string]interface{} `yaml:"config" json:"config,omitempty"`
	Profiles map[string]DbtProfile  `yaml:",inline" json:"profiles"`
}

// DbtProfile represents a single profile in profiles.yml
type DbtProfile struct {
	Target  string                   `yaml:"target" json:"target"`
	Outputs map[string]DbtConnection `yaml:"outputs" json:"outputs"`
}

// DbtConnection represents a database connection configuration
type DbtConnection struct {
	Type     string `yaml:"type" json:"type"`
	Host     string `yaml:"host,omitempty" json:"host,omitempty"`
	Port     int    `yaml:"port,omitempty" json:"port,omitempty"`
	User     string `yaml:"user,omitempty" json:"user,omitempty"`
	Password string `yaml:"password,omitempty" json:"password,omitempty"`
	DbName   string `yaml:"dbname,omitempty" json:"dbname,omitempty"` // Postgres
	Database string `yaml:"database,omitempty" json:"database,omitempty"`
	Schema   string `yaml:"schema,omitempty" json:"schema,omitempty"`
	// Additional fields for different database types
	Project   string `yaml:"project,omitempty" json:"project,omitempty"`     // BigQuery
	Dataset   string `yaml:"dataset,omitempty" json:"dataset,omitempty"`     // BigQuery
	Keyfile   string `yaml:"keyfile,omitempty" json:"keyfile,omitempty"`     // BigQuery
	Account   string `yaml:"account,omitempty" json:"account,omitempty"`     // Snowflake
	Warehouse string `yaml:"warehouse,omitempty" json:"warehouse,omitempty"` // Snowflake
	Role      string `yaml:"role,omitempty" json:"role,omitempty"`           // Snowflake
	KeepAlive bool   `yaml:"keepalive,omitempty" json:"keepalive,omitempty"` // Postgres

	SearchPath string `yaml:"search_path,omitempty" json:"search_path,omitempty"` // Postgres
	SSLMode    string `yaml:"sslmode,omitempty" json:"sslmode,omitempty"`         // Postgres

	SslDisable bool `yaml:"ssl_disable,omitempty" json:"ssl_disable,omitempty"` // MySQL

	Path string `yaml:"path,omitempty" json:"path,omitempty"` // DuckDB
	// Flexible additional properties
	Additional map[string]interface{} `yaml:",inline" json:"additional,omitempty"`
}
