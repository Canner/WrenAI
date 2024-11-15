#!/bin/sh
# declare a variable from the environment variable: DATA_PATH
data_path=${DATA_PATH:-"./"}

# touch a empty config.properties if not exists
# put a content into config.properties if not exists
if [ ! -f ${data_path}/config.properties ]; then
  echo "init config.properties"
  echo "node.environment=production" >${data_path}/config.properties
fi

# after the config.properties is created, check if config properties properly set
# if not, then append default values to the config.properties
# check if wren.experimental-enable-dynamic-fields is set, otherwise append it with true
if ! grep -q "wren.experimental-enable-dynamic-fields" ${data_path}/config.properties; then
  echo "wren.experimental-enable-dynamic-fields is not set, set it to true"
  echo "wren.experimental-enable-dynamic-fields=true" >>${data_path}/config.properties
fi

# create a folder mdl if not exists
if [ ! -d ${data_path}/mdl ]; then
  echo "create mdl folder"
  mkdir ${data_path}/mdl
fi

# put a emtpy sample.json if not exists
if [ ! -f ${data_path}/mdl/sample.json ]; then
  echo "init mdl/sample.json"
  echo "{\"catalog\": \"test_catalog\", \"schema\": \"test_schema\", \"models\": []}" >${data_path}/mdl/sample.json
fi
