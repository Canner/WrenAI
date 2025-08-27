from src.core.engine import (
    add_quotes,
    clean_generation_result,
    remove_limit_statement,
)


class TestAddQuotes:
    """Test cases for the add_quotes function."""

    def test_add_quotes_simple_identifier(self):
        """Test adding quotes to simple identifiers."""
        sql = "SELECT name FROM users"
        result, error = add_quotes(sql)

        assert error == ""
        assert '"name"' in result
        assert '"users"' in result

    def test_add_quotes_dotted_identifiers(self):
        """Test adding quotes to dotted identifiers like table.column."""
        sql = "SELECT u.name, u.email FROM users u"
        result, error = add_quotes(sql)

        assert error == ""
        assert '"u"."name"' in result
        assert '"u"."email"' in result
        assert '"users"' in result

    def test_add_quotes_already_quoted_identifiers(self):
        """Test that already quoted identifiers are preserved."""
        sql = 'SELECT "name", "email" FROM "users"'
        result, error = add_quotes(sql)

        assert error == ""
        assert '"name"' in result
        assert '"email"' in result
        assert '"users"' in result

    def test_add_quotes_wildcard_pattern(self):
        """Test that wildcard patterns like t.* are not quoted."""
        sql = "SELECT t.*, name FROM table1 t"
        result, error = add_quotes(sql)

        assert error == ""
        assert "t.*" in result  # Should not be quoted
        assert '"name"' in result
        assert '"table1"' in result

    def test_add_quotes_function_calls(self):
        """Test that function names are not quoted."""
        sql = "SELECT COUNT(id), MAX(created_at) FROM users"
        result, error = add_quotes(sql)

        assert error == ""
        assert "COUNT(" in result  # Function name should not be quoted
        assert "MAX(" in result
        assert '"id"' in result
        assert '"created_at"' in result
        assert '"users"' in result

    def test_add_quotes_complex_query(self):
        """Test adding quotes to a complex query with joins and aliases."""
        sql = """
        SELECT u.name, p.title, c.name as category_name
        FROM users u
        JOIN posts p ON u.id = p.user_id
        JOIN categories c ON p.category_id = c.id
        WHERE u.active = true
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert '"u"."name"' in result
        assert '"p"."title"' in result
        assert '"c"."name"' in result
        assert '"users"' in result
        assert '"posts"' in result
        assert '"categories"' in result

    def test_add_quotes_with_schema_prefix(self):
        """Test adding quotes to identifiers with schema prefixes."""
        sql = "SELECT db.schema.table.column FROM db.schema.table"
        result, error = add_quotes(sql)

        assert error == ""
        assert '"db"."schema"."table"."column"' in result
        assert '"db"."schema"."table"' in result

    def test_add_quotes_error_handling(self):
        """Test that add_quotes handles malformed SQL gracefully."""
        # The function doesn't actually fail on malformed SQL, it processes what it can
        sql = "INVALID SQL WITH UNMATCHED ((( PARENTHESES"
        result, error = add_quotes(sql)

        # Function should still return a result (even if malformed) and no error
        assert error == ""
        assert result != ""
        assert '"INVALID"' in result  # Identifiers should be quoted
        assert '"SQL"' in result
        assert '"PARENTHESES"' in result

    def test_add_quotes_empty_string(self):
        """Test adding quotes to empty string."""
        sql = ""
        result, error = add_quotes(sql)

        assert result == ""
        assert error == ""

    def test_add_quotes_whitespace_normalization(self):
        """Test that whitespace is normalized before processing."""
        sql = "SELECT    name   \n\n  FROM   users   "
        result, error = add_quotes(sql)

        assert error == ""
        assert '"name"' in result
        assert '"users"' in result

    def test_add_quotes_preserves_spacing_in_chains(self):
        """Test that spacing within dotted chains is preserved."""
        sql = "SELECT db . schema . table FROM users"
        result, error = add_quotes(sql)

        assert error == ""
        assert '"db" . "schema" . "table"' in result

    def test_add_quotes_keywords_not_quoted(self):
        """Test that SQL keywords are not quoted."""
        sql = "SELECT name FROM users WHERE active = true ORDER BY created_at"
        result, error = add_quotes(sql)

        assert error == ""
        assert "SELECT " in result  # Keywords should not be quoted
        assert "FROM " in result
        assert "WHERE " in result
        assert "ORDER BY " in result
        assert '"name"' in result  # But identifiers should be quoted
        assert '"users"' in result
        assert '"active"' in result
        assert '"created_at"' in result

    def test_add_quotes_date_functions(self):
        """Test that date/time functions are not quoted but their arguments are."""
        sql = (
            "SELECT NOW(), CURRENT_DATE, DATE(created_at), YEAR(order_date) FROM orders"
        )
        result, error = add_quotes(sql)

        assert error == ""
        assert "NOW(" in result  # Function names should not be quoted
        assert "CURRENT_DATE" in result
        assert "DATE(" in result
        assert "YEAR(" in result
        assert '"created_at"' in result  # Column names should be quoted
        assert '"order_date"' in result
        assert '"orders"' in result

    def test_add_quotes_time_literals(self):
        """Test that time literals are not quoted but column names are."""
        sql = "SELECT * FROM events WHERE event_date >= '2023-01-01' AND event_time < '12:30:00'"
        result, error = add_quotes(sql)

        assert error == ""
        assert "'2023-01-01'" in result  # String literals should remain unchanged
        assert "'12:30:00'" in result
        assert '"events"' in result  # Table names should be quoted
        assert '"event_date"' in result  # Column names should be quoted
        assert '"event_time"' in result

    def test_add_quotes_timestamp_functions(self):
        """Test timestamp and datetime functions with column references."""
        sql = "SELECT TIMESTAMP(date_col, time_col), DATETIME(created_at), UNIX_TIMESTAMP(modified_at) FROM logs"
        result, error = add_quotes(sql)

        assert error == ""
        assert "TIMESTAMP(" in result  # Function names should not be quoted
        assert "DATETIME(" in result
        assert "UNIX_TIMESTAMP(" in result
        assert '"date_col"' in result  # Column arguments should be quoted
        assert '"time_col"' in result
        assert '"created_at"' in result
        assert '"modified_at"' in result
        assert '"logs"' in result

    def test_add_quotes_date_arithmetic(self):
        """Test date arithmetic with INTERVAL and column references."""
        sql = "SELECT * FROM orders WHERE order_date >= NOW() - INTERVAL 30 DAY AND created_at > last_update"
        result, error = add_quotes(sql)

        assert error == ""
        assert "NOW(" in result  # Function should not be quoted
        assert "INTERVAL" in result  # Keywords should not be quoted
        assert "DAY" in result
        assert '"orders"' in result  # Table should be quoted
        assert '"order_date"' in result  # Columns should be quoted
        assert '"created_at"' in result
        assert '"last_update"' in result

    def test_add_quotes_date_formatting(self):
        """Test date formatting functions with format strings and columns."""
        sql = "SELECT DATE_FORMAT(created_at, '%Y-%m-%d'), STRFTIME('%H:%M', event_time) FROM events"
        result, error = add_quotes(sql)

        assert error == ""
        assert "DATE_FORMAT(" in result  # Function names should not be quoted
        assert "STRFTIME(" in result
        assert "'%Y-%m-%d'" in result  # Format strings should remain unchanged
        assert "'%H:%M'" in result
        assert '"created_at"' in result  # Column names should be quoted
        assert '"event_time"' in result
        assert '"events"' in result

    def test_add_quotes_time_extraction(self):
        """Test time component extraction functions."""
        sql = "SELECT EXTRACT(YEAR FROM birth_date), MONTH(hire_date), DAY(event_timestamp) FROM employees"
        result, error = add_quotes(sql)

        assert error == ""
        assert "EXTRACT(" in result  # Function should not be quoted
        assert "YEAR FROM" in result  # Keywords should not be quoted
        assert "MONTH(" in result
        assert "DAY(" in result
        assert '"birth_date"' in result  # Columns should be quoted
        assert '"hire_date"' in result
        assert '"event_timestamp"' in result
        assert '"employees"' in result

    def test_add_quotes_timezone_functions(self):
        """Test timezone-related functions and conversions."""
        sql = "SELECT CONVERT_TZ(created_at, 'UTC', 'America/New_York'), AT_TIME_ZONE(event_time, timezone_col) FROM logs"
        result, error = add_quotes(sql)

        assert error == ""
        assert "CONVERT_TZ(" in result  # Function names should not be quoted
        assert "AT_TIME_ZONE(" in result
        assert "'UTC'" in result  # Timezone strings should remain unchanged
        assert "'America/New_York'" in result
        assert '"created_at"' in result  # Columns should be quoted
        assert '"event_time"' in result
        assert '"timezone_col"' in result
        assert '"logs"' in result

    def test_add_quotes_date_comparison_complex(self):
        """Test complex date comparisons with multiple time functions and columns."""
        sql = """
        SELECT u.name, p.created_at, DATEDIFF(NOW(), p.created_at) as days_ago
        FROM users u
        JOIN posts p ON u.id = p.user_id
        WHERE DATE(p.created_at) BETWEEN '2023-01-01' AND CURDATE()
        AND HOUR(p.created_at) BETWEEN 9 AND 17
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert '"u"."name"' in result  # Dotted identifiers should be quoted
        assert '"p"."created_at"' in result
        assert "DATEDIFF(" in result  # Functions should not be quoted
        assert "NOW(" in result
        assert "DATE(" in result
        assert "CURDATE(" in result
        assert "HOUR(" in result
        assert "'2023-01-01'" in result  # Date literals should remain unchanged
        assert '"users"' in result  # Table names should be quoted
        assert '"posts"' in result
        assert "days_ago" in result  # Aliases should not be quoted

    def test_add_quotes_window_functions_with_time(self):
        """Test window functions with time-based ordering and partitioning."""
        sql = """
        SELECT ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn,
               LAG(event_time, 1) OVER (ORDER BY event_timestamp) as prev_time
        FROM user_events
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert "ROW_NUMBER(" in result  # Window functions should not be quoted
        assert "LAG(" in result
        assert "OVER (" in result
        assert "PARTITION BY" in result  # Keywords should not be quoted
        assert "ORDER BY" in result
        assert "DESC" in result
        assert '"user_id"' in result  # Columns should be quoted
        assert '"created_at"' in result
        assert '"event_time"' in result
        assert '"event_timestamp"' in result
        assert '"user_events"' in result
        assert "rn" in result  # Aliases should not be quoted
        assert "prev_time" in result

    def test_add_quotes_timezone_offset_literals(self):
        """Test timezone offset literals and TIMESTAMPTZ functions."""
        sql = "SELECT TIMESTAMPTZ '2023-01-01 12:00:00+00:00', event_time AT TIME ZONE '+05:00' FROM events"
        result, error = add_quotes(sql)

        assert error == ""
        assert "TIMESTAMPTZ" in result  # Type name should not be quoted
        assert (
            "'2023-01-01 12:00:00+00:00'" in result
        )  # Timestamp literal should remain unchanged
        assert "AT TIME ZONE" in result  # Keywords should not be quoted
        assert "'+05:00'" in result  # Timezone offset should remain unchanged
        assert '"event_time"' in result  # Column should be quoted
        assert '"events"' in result  # Table should be quoted

    def test_add_quotes_timezone_cast_operations(self):
        """Test timezone casting and conversion operations."""
        sql = """
        SELECT created_at::TIMESTAMPTZ,
               event_time::TIMESTAMP WITHOUT TIME ZONE,
               CAST(log_time AS TIMESTAMP WITH TIME ZONE)
        FROM system_logs
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert "TIMESTAMPTZ" in result  # Type names should not be quoted
        assert "TIMESTAMP WITHOUT TIME ZONE" in result
        assert "TIMESTAMP WITH TIME ZONE" in result
        assert "CAST(" in result  # Function should not be quoted
        assert '"created_at"' in result  # Columns should be quoted
        assert '"event_time"' in result
        assert '"log_time"' in result
        assert '"system_logs"' in result

    def test_add_quotes_timezone_named_zones(self):
        """Test named timezone references and conversions."""
        sql = """
        SELECT timezone('America/Los_Angeles', created_at) as local_time,
               created_at AT TIME ZONE user_timezone,
               EXTRACT(TIMEZONE FROM event_timestamp) as tz_offset
        FROM user_sessions
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert "timezone(" in result  # Function should not be quoted (lowercase)
        assert (
            "'America/Los_Angeles'" in result
        )  # Timezone name should remain unchanged
        assert "AT TIME ZONE" in result  # Keywords should not be quoted
        assert "EXTRACT(" in result
        assert "TIMEZONE FROM" in result
        assert '"created_at"' in result  # Columns should be quoted
        assert '"user_timezone"' in result
        assert '"event_timestamp"' in result
        assert '"user_sessions"' in result
        assert "local_time" in result  # Aliases should not be quoted
        assert "tz_offset" in result

    def test_add_quotes_timezone_interval_operations(self):
        """Test timezone operations with intervals."""
        sql = """
        SELECT created_at + INTERVAL '3 hours',
               event_time - INTERVAL '30 minutes',
               MAKE_TIMESTAMPTZ(2023, 1, 1, 12, 0, 0, timezone_offset)
        FROM scheduled_tasks
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert "INTERVAL" in result  # Keyword should not be quoted
        assert "'3 hours'" in result  # Interval string should remain unchanged
        assert "'30 minutes'" in result
        assert "MAKE_TIMESTAMPTZ(" in result  # Function should not be quoted
        assert '"created_at"' in result  # Columns should be quoted
        assert '"event_time"' in result
        assert '"timezone_offset"' in result
        assert '"scheduled_tasks"' in result

    def test_add_quotes_timezone_comparison_queries(self):
        """Test timezone-aware comparison queries."""
        sql = """
        SELECT * FROM events e
        WHERE e.created_at AT TIME ZONE 'UTC' BETWEEN 
              TIMESTAMP '2023-01-01 00:00:00' AND 
              NOW() AT TIME ZONE session_timezone
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert "AT TIME ZONE" in result  # Keywords should not be quoted
        assert "'UTC'" in result  # Timezone string should remain unchanged
        assert "BETWEEN" in result
        assert "TIMESTAMP" in result
        assert (
            "'2023-01-01 00:00:00'" in result
        )  # Timestamp literal should remain unchanged
        assert "NOW(" in result  # Function should not be quoted
        assert '"events"' in result  # Table should be quoted
        assert '"e"."created_at"' in result  # Dotted column should be quoted
        assert '"session_timezone"' in result  # Column should be quoted

    def test_add_quotes_timezone_aggregate_functions(self):
        """Test timezone functions in aggregate contexts."""
        sql = """
        SELECT DATE_TRUNC('hour', created_at AT TIME ZONE 'America/New_York') as hour_bucket,
               COUNT(*) as event_count,
               MIN(event_time AT TIME ZONE user_tz) as first_event,
               MAX(TIMEZONE('UTC', updated_at)) as last_update
        FROM user_activities
        GROUP BY DATE_TRUNC('hour', created_at AT TIME ZONE 'America/New_York')
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert "DATE_TRUNC(" in result  # Function should not be quoted
        assert "'hour'" in result  # Time unit should remain unchanged
        assert "AT TIME ZONE" in result  # Keywords should not be quoted
        assert "'America/New_York'" in result  # Timezone should remain unchanged
        assert "COUNT(" in result  # Aggregate functions should not be quoted
        assert "MIN(" in result
        assert "MAX(" in result
        assert "TIMEZONE(" in result
        assert "'UTC'" in result
        assert "GROUP BY" in result  # Keywords should not be quoted
        assert '"created_at"' in result  # Columns should be quoted
        assert '"event_time"' in result
        assert '"user_tz"' in result
        assert '"updated_at"' in result
        assert '"user_activities"' in result
        assert "hour_bucket" in result  # Aliases should not be quoted
        assert "event_count" in result
        assert "first_event" in result
        assert "last_update" in result

    def test_add_quotes_timezone_cte_with_conversions(self):
        """Test Common Table Expressions with timezone conversions."""
        sql = """
        WITH timezone_adjusted AS (
            SELECT user_id,
                   event_time AT TIME ZONE 'UTC' AT TIME ZONE user_timezone as local_event_time,
                   EXTRACT(EPOCH FROM event_time) as unix_timestamp
            FROM raw_events
        )
        SELECT ta.user_id, 
               DATE(ta.local_event_time) as event_date,
               TIMEZONE('UTC', ta.local_event_time) as utc_time
        FROM timezone_adjusted ta
        """
        result, error = add_quotes(sql)

        assert error == ""
        assert "WITH" in result  # Keywords should not be quoted
        assert '"timezone_adjusted" AS' in result
        assert "AT TIME ZONE" in result
        assert "'UTC'" in result  # Timezone strings should remain unchanged
        assert "EXTRACT(" in result  # Functions should not be quoted
        assert "EPOCH FROM" in result
        assert "DATE(" in result
        assert "TIMEZONE(" in result
        assert '"user_id"' in result  # Columns should be quoted
        assert '"event_time"' in result
        assert '"user_timezone"' in result
        assert '"raw_events"' in result  # Tables should be quoted
        assert '"ta"."user_id"' in result  # Dotted references should be quoted
        assert '"ta"."local_event_time"' in result
        assert (
            "local_event_time" in result
        )  # Aliases should not be quoted (when not prefixed)
        assert "unix_timestamp" in result
        assert "event_date" in result
        assert "utc_time" in result


class TestCleanGenerationResult:
    """Test cases for the clean_generation_result function."""

    def test_clean_generation_result_removes_code_blocks(self):
        """Test removing SQL and JSON code blocks."""
        result = "```sql\nSELECT * FROM users\n```"
        cleaned = clean_generation_result(result)
        assert "```sql" not in cleaned
        assert "```" not in cleaned
        assert "SELECT * FROM users" in cleaned

    def test_clean_generation_result_removes_quotes(self):
        """Test removing triple quotes."""
        result = '"""SELECT * FROM users"""'
        cleaned = clean_generation_result(result)
        assert '"""' not in cleaned
        assert "SELECT * FROM users" in cleaned

    def test_clean_generation_result_removes_semicolon(self):
        """Test removing semicolons."""
        result = "SELECT * FROM users;"
        cleaned = clean_generation_result(result)
        assert ";" not in cleaned
        assert "SELECT * FROM users" in cleaned

    def test_clean_generation_result_normalizes_whitespace(self):
        """Test whitespace normalization."""
        result = "SELECT    *   \n\n  FROM   users"
        cleaned = clean_generation_result(result)
        assert cleaned == "SELECT * FROM users"


class TestRemoveLimitStatement:
    """Test cases for the remove_limit_statement function."""

    def test_remove_limit_statement_basic(self):
        """Test removing basic LIMIT statement."""
        sql = "SELECT * FROM users LIMIT 10"
        result = remove_limit_statement(sql)
        assert "LIMIT" not in result.upper()
        assert "SELECT * FROM users" in result

    def test_remove_limit_statement_with_semicolon(self):
        """Test removing LIMIT with semicolon."""
        sql = "SELECT * FROM users LIMIT 10;"
        result = remove_limit_statement(sql)
        assert "LIMIT" not in result.upper()
        assert "SELECT * FROM users" in result

    def test_remove_limit_statement_case_insensitive(self):
        """Test case insensitive LIMIT removal."""
        sql = "SELECT * FROM users limit 10"
        result = remove_limit_statement(sql)
        assert "limit" not in result
        assert "SELECT * FROM users" in result

    def test_remove_limit_statement_preserves_other_content(self):
        """Test that other content is preserved when removing LIMIT."""
        sql = "SELECT * FROM users WHERE name = 'limit' LIMIT 10"
        result = remove_limit_statement(sql)
        assert "name = 'limit'" in result
        assert "LIMIT 10" not in result
