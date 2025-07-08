package dbt

// WrenMDLManifest represents the complete Wren MDL structure
type WrenMDLManifest struct {
	Catalog       string         `json:"catalog"`
	Schema        string         `json:"schema"`
	Models        []WrenModel    `json:"models"`
	Relationships []Relationship `json:"relationships"`
	Views         []View         `json:"views"`
}

// WrenModel represents a model in the Wren MDL format
type WrenModel struct {
	Name           string            `json:"name"`
	TableReference TableReference    `json:"tableReference"`
	Columns        []WrenColumn      `json:"columns"`
	PrimaryKey     string            `json:"primaryKey,omitempty"`
	Cached         bool              `json:"cached,omitempty"`
	RefreshTime    string            `json:"refreshTime,omitempty"`
	Properties     map[string]string `json:"properties,omitempty"`
}

// TableReference represents a reference to a table
type TableReference struct {
	Catalog string `json:"catalog,omitempty"`
	Schema  string `json:"schema,omitempty"`
	Table   string `json:"table"`
}

// WrenColumn represents a column in the Wren MDL format
type WrenColumn struct {
	Name         string            `json:"name"`
	Type         string            `json:"type"`
	Relationship string            `json:"relationship,omitempty"`
	IsCalculated bool              `json:"isCalculated,omitempty"`
	NotNull      bool              `json:"notNull,omitempty"`
	Expression   *string           `json:"expression,omitempty"`
	Properties   map[string]string `json:"properties,omitempty"`
}

// Relationship represents a relationship between models
type Relationship struct {
	Name       string            `json:"name"`
	Models     []string          `json:"models"`
	JoinType   string            `json:"joinType"`
	Condition  string            `json:"condition"`
	Properties map[string]string `json:"properties,omitempty"`
}

// View represents a view in the Wren MDL format
type View struct {
	Name       string            `json:"name"`
	Statement  string            `json:"statement"`
	Properties map[string]string `json:"properties,omitempty"`
}
