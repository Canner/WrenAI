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
  echo "init config.properties"
  echo "node.environment=production" > ${data_path}/config.properties
fi

# after the config.properties is created, check if config properties properly set
# if not, then append default values to the config.properties
# check if wren.experimental-enable-dynamic-fields is set, otherwise append it with true
if ! grep -q "wren.experimental-enable-dynamic-fields" ${data_path}/config.properties; then
  echo "wren.experimental-enable-dynamic-fields is not set, set it to true"
  echo "wren.experimental-enable-dynamic-fields=true" >> ${data_path}/config.properties
fi

# create a folder mdl if not exists
if [ ! -d ${data_path}/mdl ]; then
  echo "create mdl folder"
  mkdir ${data_path}/mdl
fi

# put a emtpy sample.json if not exists
if [ ! -f ${data_path}/mdl/sample.json ]; then
  echo "init mdl/sample.json"
  echo "{\"catalog\": \"test_catalog\", \"schema\": \"test_schema\", \"models\": []}" > ${data_path}/mdl/sample.json
fi

# put a accounts file in data_path if not exists
# accounts is a file contains the authentication information
# the format is like: `username password` per line
if [ ! -f ${data_path}/accounts ]; then
  echo "init accounts file"
  echo "${pg_username} ${pg_password}" > ${data_path}/accounts
fi
