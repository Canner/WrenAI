export const ERROR_TEXTS = {
  CONNECTION: {
    DISPLAY_NAME: {
      REQUIRED: 'Please input display name.',
    },
    PROJECT_ID: {
      REQUIRED: 'Please input project id.',
    },
    DATASET_ID: {
      REQUIRED: 'Please input dataset ID.',
    },
    CREDENTIAL: {
      REQUIRED: 'Please upload credential.',
    },
    INIT_SQL: {
      REQUIRED: 'Please input initial SQL statements.',
    },
    CONFIGURATION: {
      KEY: {
        REQUIRED: 'Please input configuration key.',
      },
      VALUE: {
        REQUIRED: 'Please input configuration value.',
      },
    },
    HOST: {
      REQUIRED: 'Please input host.',
      INVALID:
        "Invalid host. Use 'host.docker.internal' on macOS/Windows to connect to the local database.",
    },
    PORT: {
      REQUIRED: 'Please input port.',
    },
    USER: {
      REQUIRED: 'Please input user.',
    },
    USERNAME: {
      REQUIRED: 'Please input username.',
    },
    PASSWORD: {
      REQUIRED: 'Please input password.',
    },
    DATABASE: {
      REQUIRED: 'Please input database name.',
    },
    SCHEMA: {
      REQUIRED: 'Please input schema name.',
    },
    SCHEMAS: {
      REQUIRED: 'Please input list of catalog.schema separated by comma.',
    },
    ACCOUNT: {
      REQUIRED: 'Please input account.',
    },
    S3_STAGING_DIR: {
      REQUIRED: 'Please input S3 staging directory.',
    },
    AWS_REGION: {
      REQUIRED: 'Please input AWS region.',
    },
    AWS_ACCESS_KEY: {
      REQUIRED: 'Please input AWS access key ID.',
    },
    AWS_SECRET_KEY: {
      REQUIRED: 'Please input AWS secret access key.',
    },
    CLUSTER_IDENTIFIER: {
      REQUIRED: 'Please input cluster identifier.',
    },
    PRIVATE_KEY_FILE: {
      REQUIRED: 'Please upload a private key file.',
    },
  },
  ADD_RELATION: {
    FROM_FIELD: {
      REQUIRED: 'Please select a field.',
    },
    TO_FIELD: {
      REQUIRED: 'Please select a field.',
    },
    RELATION_TYPE: {
      REQUIRED: 'Please select a relationship type.',
    },
    RELATIONSHIP: {
      EXIST: 'This relationship already exists.',
    },
  },
  SETUP_MODEL: {
    TABLE: {
      REQUIRED: 'Please select at least one table.',
    },
  },
  SAVE_AS_VIEW: {
    NAME: {
      REQUIRED: 'Please input view name.',
    },
  },
  MODELING_CREATE_MODEL: {
    TABLE: {
      REQUIRED: 'Please select a table.',
    },
    COLUMNS: {
      REQUIRED: 'Please select at least one column.',
    },
    PRIMARY_KEY: {
      INVALID:
        'Please select again, the primary key must be one of the selected columns.',
    },
  },
  CALCULATED_FIELD: {
    NAME: {
      REQUIRED: 'Please input field name.',
    },
    EXPRESSION: {
      REQUIRED: 'Please select an expression.',
    },
    LINEAGE: {
      REQUIRED: 'Please select a field.',
      INVALID_STRING_TYPE: 'Please select a string type field.',
      INVALID_NUMBER_TYPE: 'Please select a number type field.',
    },
  },
  SQL_PAIR: {
    SQL: {
      REQUIRED: 'Please input SQL statement.',
    },
    QUESTION: {
      REQUIRED: 'Please input a matching question.',
      MAX_LENGTH: 'Question must be 300 characters or fewer.',
    },
  },
  INSTRUCTION: {
    DETAILS: {
      REQUIRED: 'Please input an instruction details.',
    },
    QUESTIONS: {
      REQUIRED: 'Please input a matching question.',
    },
    IS_DEFAULT_GLOBAL: {
      REQUIRED: 'Please select how to apply this instruction.',
    },
  },
  FIX_SQL: {
    SQL: {
      REQUIRED: 'Please input SQL statement.',
    },
  },
  ADJUST_REASONING: {
    SELECTED_MODELS: {
      REQUIRED: 'Please select at least one model',
    },
    STEPS: {
      REQUIRED: 'Please input reasoning steps',
      MAX_LENGTH: 'Reasoning steps must be 6000 characters or fewer.',
    },
  },
  IMPORT_DATA_SOURCE_SQL: {
    SQL: {
      REQUIRED: 'Please input SQL statement.',
    },
  },
  CRON: {
    REQUIRED: 'Please input cron expression.',
    INVALID: 'Invalid cron expression.',
  },
  CACHE_SETTINGS: {
    DAY: {
      REQUIRED: 'Please select day.',
    },
    TIME: {
      REQUIRED: 'Please select time.',
    },
  },
};
