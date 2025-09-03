# Requirement for DBT project
This part outlines some requirements for the target dbt project:
- Ensure the DBT project is qualified and generates the required files:
  - `catalog.json`
  - `manifest.json`
  Execute the following commands:
	```
	dbt build
	dbt docs generate
	```
- Prepare the profile of the dbt project for the connection info of your database.
  - `profiles.yml`


# How to Support a New Data Source

This document outlines the steps required to add support for a new data source to the dbt project converter.
The target data source must be supported by both dbt and the Wren engine:
- [dbt supported databases](https://docs.getdbt.com/docs/supported-data-platforms)
- [Wren engine supported data sources](https://docs.getwren.ai/oss/wren_engine_api#tag/AthenaConnectionInfo)

## 1. Implement the DataSource Interface

The first step is to define a new struct for your data source and implement the `DataSource` interface defined in `data_source.go`.

The `DataSource` interface is as follows:

```go
type DataSource interface {
    GetType() string
    Validate() error
    MapType(sourceType string) string
}
```

### Steps:

1.  **Define Your Struct**: Create a new struct that represents the connection properties for your data source. The fields in this struct should correspond to the properties defined in the [Wren engine's API documentation](https://docs.getwren.ai/oss/wren_engine_api#tag/SnowflakeConnectionInfo) for the target data source.

    For example, to add support for `Snowflake`, you would define the following struct:

    ```go
    type WrenSnowflakeDataSource struct {
        Account   string `json:"account"`
        User      string `json:"user"`
        Password  string `json:"password"`
        Database  string `json:"database"`
        Warehouse string `json:"warehouse"`
        // ... other properties
    }
    ```

2.  **Implement `GetType()`**: This method should return a string that identifies your data source type (e.g., `"snowflake"`).

3.  **Implement `Validate()`**: This method should check if the essential properties of your data source are set and valid. Return an error if validation fails.

4.  **Implement `MapType()`**: This method is crucial for mapping data types from the source system (as defined in `catalog.json`) to Wren's supported data types (e.g., `integer`, `varchar`, `timestamp`).

## 2. Add Conversion Logic in `data_source.go`

After implementing the interface, you need to integrate your new data source into the conversion logic. This is done by updating the `convertConnectionToDataSource` function in `data_source.go`.

Add a new `case` to the `switch` statement that matches the `type` field from the dbt `profiles.yml` file. This new case will be responsible for creating an instance of your new data source struct from the dbt connection details.

### Example:

```go
// in data_source.go

func convertConnectionToDataSource(conn DbtConnection, dbtHomePath, profileName, outputName string) (DataSource, error) {
	switch strings.ToLower(conn.Type) {
	case "postgres", "postgresql":
		return convertToPostgresDataSource(conn)
	case "duckdb":
		return convertToLocalFileDataSource(conn, dbtHomePath)
    // Add your new case here
	case "snowflake":
		return convertToSnowflakeDataSource(conn) // Implement this function
	default:
		// ...
	}
}

// Implement the conversion function
func convertToSnowflakeDataSource(conn DbtConnection) (*WrenSnowflakeDataSource, error) {
    // Logic to extract snowflake properties from conn
    // and return a new *WrenSnowflakeDataSource
}
```

## 3. Handle the New Data Source in `ConvertDbtProjectCore`

The `ConvertDbtProjectCore` function in `converter.go` is responsible for generating the `wren-datasource.json` file. You must add your new data source to the `switch` statement within this function to ensure it is correctly serialized.

### Steps:

1.  **Locate the `switch` statement**: Find the `switch typedDS := ds.(type)` block inside `ConvertDbtProjectCore`.
2.  **Add a new `case`**: Add a new `case` for your data source struct. Inside this case, construct the `wrenDataSource` map with the correct `type` and `properties`.

### Example:

```go
// in converter.go's ConvertDbtProjectCore function

// ...
			switch typedDS := ds.(type) {
			case *WrenPostgresDataSource:
				// ...
			case *WrenLocalFileDataSource:
				// ...
            // Add your new case here
			case *WrenSnowflakeDataSource:
				wrenDataSource = map[string]interface{}{
					"type": "snowflake",
					"properties": map[string]interface{}{
						"account":  typedDS.Account,
						"user":     typedDS.User,
						"password": typedDS.Password,
						"database": typedDS.Database,
                        "warehouse": typedDS.Warehouse,
						// ... other properties
					},
				}
			default:
				// ...
			}
// ...
```

**Note on File-Based Data Sources**: If your data source is file-based (like `duckdb`), you also need to add logic to set the `localStoragePath` variable correctly within `ConvertDbtProjectCore`. This path tells the Wren engine where to find the data files.
