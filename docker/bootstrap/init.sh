#!/bin/sh
# declare a variable from the environment variable: DATA_PATH
data_path=${DATA_PATH:-"./"}
# get default password from environment variable, if not exists, then throw error
if [ -z "$PG_PASSWORD" ]; then
  echo "PG_PASSWORD is not set"
  exit 1
fi
pg_password=$PG_PASSWORD
# get default username from environment variable, if not exists, then throw error
if [ -z "$PG_USERNAME" ]; then
  echo "PG_USERNAME is not set"
  exit 1
fi
pg_username=$PG_USERNAME

# touch a empty config.properties if not exists
# put a content into config.properties if not exists
if [ ! -f ${data_path}/config.properties ]; then
    echo "node.environment=production" > ${data_path}/config.properties
    echo "wren.experimental-enable-dynamic-fields=true" > ${data_path}/config.properties
#    echo "PG_DATABASE=\"tpch\"" >> ${data_path}/config.properties
fi

# create a folder mdl if not exists
if [ ! -d ${data_path}/mdl ]; then
  mkdir ${data_path}/mdl
fi

# put a emtpy sample.json if not exists
if [ ! -f ${data_path}/mdl/sample.json ]; then
  echo "{\"catalog\": \"test_catalog\", \"schema\": \"test_schema\", \"models\": []}" > ${data_path}/mdl/sample.json
fi

# put a accounts file in data_path if not exists
# accounts is a file contains the authentication information
# the format is like: `username password` per line
if [ ! -f ${data_path}/accounts ]; then
  echo "${pg_username} ${pg_password}" > ${data_path}/accounts
fi
