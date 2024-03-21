#!/bin/sh
# declare a variable from the environment variable: DATA_PATH
data_path=${DATA_PATH:-"./"}

# touch a empty config.properties if not exists
# put a content into config.properties if not exists
if [ ! -f ${data_path}/config.properties ]; then
    echo "node.environment=production" > ${data_path}/config.properties
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