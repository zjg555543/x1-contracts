rm -rf node_modules/

rm deployment/deploy_output.json 
git reset --hard

cp ../zkevm-docker/config/deploy_parameters.json deployment/deploy_parameters.json
cp ../zkevm-docker/config/contract_env_example .env

npm i
npm run deploy:testnet:ZkEVM:localhost
