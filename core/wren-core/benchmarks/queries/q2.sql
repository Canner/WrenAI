WITH
    "filtered_accounts" AS (
        SELECT
            "a"."account_id",
            "a"."created_date"
        FROM
            "public_accounts_table" AS "a"
        WHERE
            NOT LOWER("a"."user_name") LIKE LOWER('%test%')
            AND (
                "a"."status_flag" IS NULL
                OR "a"."status_flag" = FALSE
            )
            AND NOT EXISTS (
                SELECT
                    1
                FROM
                    "public_users_table" AS "u"
                WHERE
                    LOWER("u"."email_address") LIKE LOWER('%wrentest%')
                    AND LOWER("u"."user_id") = LOWER("a"."account_id")
            )
    ),
    "phase1_challenges" AS (
        SELECT
            "pc"."challenge_id",
            "pc"."account_ref",
            "pc"."end_time"
        FROM
            "public_challenges_table" AS "pc"
            JOIN "filtered_accounts" AS "fa" ON LOWER("pc"."account_ref") = LOWER("fa"."account_id")
        WHERE
            "pc"."challenge_ref" IS NULL
            AND "pc"."challenge_status" = 2
    ),
    "phase2_challenges" AS (
        SELECT
            "pc"."challenge_id",
            "pc"."account_ref",
            "pc"."end_time"
        FROM
            "public_challenges_table" AS "pc"
            JOIN "filtered_accounts" AS "fa" ON LOWER("pc"."account_ref") = LOWER("fa"."account_id")
            JOIN "public_challenges_table" AS "pc_ref" ON LOWER("pc"."challenge_ref") = LOWER("pc_ref"."challenge_id")
        WHERE
            "pc_ref"."challenge_ref" IS NULL
            AND "pc"."challenge_status" = 2
    ),
    "phase3_challenges" AS (
        SELECT
            "pc"."challenge_id",
            "pc"."account_ref",
            "pc"."end_time"
        FROM
            "public_challenges_table" AS "pc"
            JOIN "filtered_accounts" AS "fa" ON LOWER("pc"."account_ref") = LOWER("fa"."account_id")
            JOIN "public_challenges_table" AS "pc_ref" ON LOWER("pc"."challenge_ref") = LOWER("pc_ref"."challenge_id")
            JOIN "public_challenges_table" AS "pc_ref2" ON LOWER("pc_ref"."challenge_ref") = LOWER("pc_ref2"."challenge_id")
        WHERE
            "pc_ref2"."challenge_ref" IS NULL
            AND "pc"."challenge_status" = 2
    ),
    "phase1_by_endtime" AS (
        SELECT
            CAST("pc"."end_time" AS DATE) AS "pass_date",
            COUNT(DISTINCT "pc"."account_ref") AS "phase1_pass_count"
        FROM
            "phase1_challenges" AS "pc"
        GROUP BY
            1
    ),
    "phase2_by_endtime" AS (
        SELECT
            CAST("pc"."end_time" AS DATE) AS "pass_date",
            COUNT(DISTINCT "pc"."account_ref") AS "phase2_pass_count"
        FROM
            "phase2_challenges" AS "pc"
        GROUP BY
            1
    ),
    "phase3_by_endtime" AS (
        SELECT
            CAST("pc"."end_time" AS DATE) AS "pass_date",
            COUNT(DISTINCT "pc"."account_ref") AS "phase3_pass_count"
        FROM
            "phase3_challenges" AS "pc"
        GROUP BY
            1
    ),
    "phase1_by_account_creation" AS (
        SELECT
            CAST("fa"."created_date" AS DATE) AS "pass_date",
            COUNT(DISTINCT "pc"."account_ref") AS "phase1_pass_count"
        FROM
            "phase1_challenges" AS "pc"
            JOIN "filtered_accounts" AS "fa" ON LOWER("pc"."account_ref") = LOWER("fa"."account_id")
        GROUP BY
            1
    ),
    "phase2_by_account_creation" AS (
        SELECT
            CAST("fa"."created_date" AS DATE) AS "pass_date",
            COUNT(DISTINCT "pc"."account_ref") AS "phase2_pass_count"
        FROM
            "phase2_challenges" AS "pc"
            JOIN "filtered_accounts" AS "fa" ON LOWER("pc"."account_ref") = LOWER("fa"."account_id")
        GROUP BY
            1
    ),
    "phase3_by_account_creation" AS (
        SELECT
            CAST("fa"."created_date" AS DATE) AS "pass_date",
            COUNT(DISTINCT "pc"."account_ref") AS "phase3_pass_count"
        FROM
            "phase3_challenges" AS "pc"
            JOIN "filtered_accounts" AS "fa" ON LOWER("pc"."account_ref") = LOWER("fa"."account_id")
        GROUP BY
            1
    ),
    "all_dates" AS (
        SELECT
            "pass_date"
        FROM
            "phase1_by_endtime"
        UNION
        SELECT
            "pass_date"
        FROM
            "phase2_by_endtime"
        UNION
        SELECT
            "pass_date"
        FROM
            "phase3_by_endtime"
        UNION
        SELECT
            "pass_date"
        FROM
            "phase1_by_account_creation"
        UNION
        SELECT
            "pass_date"
        FROM
            "phase2_by_account_creation"
        UNION
        SELECT
            "pass_date"
        FROM
            "phase3_by_account_creation"
    )
SELECT
    "ad"."pass_date",
    'challenge_end_time' AS "date_type",
    COALESCE("p1"."phase1_pass_count", 0) AS "phase1_pass_count",
    COALESCE("p2"."phase2_pass_count", 0) AS "phase2_pass_count",
    COALESCE("p3"."phase3_pass_count", 0) AS "phase3_pass_count"
FROM
    "all_dates" AS "ad"
    LEFT JOIN "phase1_by_endtime" AS "p1" ON "ad"."pass_date" = "p1"."pass_date"
    LEFT JOIN "phase2_by_endtime" AS "p2" ON "ad"."pass_date" = "p2"."pass_date"
    LEFT JOIN "phase3_by_endtime" AS "p3" ON "ad"."pass_date" = "p3"."pass_date"
UNION ALL
SELECT
    "ad"."pass_date",
    'account_creation_date' AS "date_type",
    COALESCE("p1"."phase1_pass_count", 0) AS "phase1_pass_count",
    COALESCE("p2"."phase2_pass_count", 0) AS "phase2_pass_count",
    COALESCE("p3"."phase3_pass_count", 0) AS "phase3_pass_count"
FROM
    "all_dates" AS "ad"
    LEFT JOIN "phase1_by_account_creation" AS "p1" ON "ad"."pass_date" = "p1"."pass_date"
    LEFT JOIN "phase2_by_account_creation" AS "p2" ON "ad"."pass_date" = "p2"."pass_date"
    LEFT JOIN "phase3_by_account_creation" AS "p3" ON "ad"."pass_date" = "p3"."pass_date"
ORDER BY
    "pass_date" DESC,
    "date_type" ASC