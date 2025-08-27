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
