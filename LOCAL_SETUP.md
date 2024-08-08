# WREN-AI Local Setup Guide - Windows.

Note: 
a linux/unix environment is preferable as windows might now support make scripts and running docker.


## Perform WSL installation:
Run the following command in an elevated powershell.  
`wsl --install Ubuntu`

Enter the username and sudo password for Linux Distro.

## Dev-Env Setup
Run following commands in order to install pre-requisite packages in new linux wsl.  

**Upgrade default packages**   
`sudo apt-get update && apt-get upgrade`

**install build essentials**   
`sudo apt-get install -y make build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev libncursesw5-dev xz-utils tk-dev libffi-dev liblzma-dev python3-openssl`

**install pyenv**  
`curl https://pyenv.run | bash`  

`echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bashrc`  
`echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bashrc`  
`echo 'eval "$(pyenv init -)"' >> ~/.bashrc`  
  
`echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.profile`  
`echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.profile`  
`echo 'eval "$(pyenv init -)"' >> ~/.profile`  


`echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bash_profile`  
`echo '[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bash_profile`  
`echo 'eval "$(pyenv init -)"' >> ~/.bash_profile` 


**install python 3.12.0**    
`pyenv install 3.12.0`  
`pyenv global 3.12.0`  

`python -m pip install setuptools`  


**install poetry**  
`curl -sSL https://install.python-poetry.org | python3 - --version 1.7.1`

`vi .bashrc`  
Add `export PATH="/home/skuma652/.local/bin:$PATH"` to bash  
`:wq`   
`source ~/.bashrc`  
`bash`  


**node-js**

`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash`  
`source ~/.bashrc`  
`nvm list-remote`  
`nvm install v16.20.2`  


**docker**  
`sudo apt install docker.io`  
`sudo apt install docker-compose`  

### Given permission to user for docker process.  
`sudo chmod 777 /var/run/docker.sock`  
`docker images , ps -a , docker logs <container-id>`  



## Code setup and run  
clone wrenai project inside a WSL folder.  
run `poetry install` followed by `poetry update` inside wren-ai-service  

set wren-engine platfrom to `linux/amd64` inside **wren-ai-service/eval/wren-engine/.env**  

Create a `config.properties` file inside **wren-ai-service/src/eval/wren-engine/etc** 
------------------------
Insert following values for defaults
------------------------
bigquery.bucket-name=  
bigquery.credentials-key=  
bigquery.location=asia-east1  
bigquery.project-id=wrenai  
duckdb.storage.access-key=  
duckdb.storage.secret-key=   
node.environment=production  
pg-wire-protocol.auth.file=  
wren.datasource.type=duckdb  
wren.directory=/usr/src/app/etc/mdl  
wren.experimental-enable-dynamic-fields=true  


### Run commands 

cd into `/wren-ai-service/demo/` run following commands into 3 different terminals   
`make prepare` :  deploys wren-engine , qdrant , redis cache  
`make ai` :  runs wren-ai-service at port 5556  
`make ui` : runs wren-ui at port 3000  

 

 ## Special Notes

 For devs using corporate work PCs for this setup.  
 If SSL cert issues are thrown while running wren-ai-service or wren-ui , it means the PC has some network security application running like Zscalar.  

 You need to add truststore certificates before running.  

Following URL shows some examples.  
 `https://help.zscaler.com/zia/adding-custom-certificate-application-specific-trust-store`




