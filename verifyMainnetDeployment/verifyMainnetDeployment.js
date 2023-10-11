const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.HARDHAT_NETWORK = "hardhat";
const { ethers } = require("hardhat");
const { expect } = require('chai');

const deployMainnet = require("./mainnetDeployment.json");
const mainnetDeployParameters = require("./mainnetDeployParameters.json");

const pathFflonkVerifier = '../artifacts/contracts/verifiers/FflonkVerifier.sol/FflonkVerifier.json';
const pathXagonZkEVMDeployer = '../artifacts/contracts/deployment/XagonZkEVMDeployer.sol/XagonZkEVMDeployer.json';
const pathXagonZkEVMBridge = '../artifacts/contracts/XagonZkEVMBridge.sol/XagonZkEVMBridge.json';
const pathTransparentProxyOZUpgradeDep = '../node_modules/@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol/TransparentUpgradeableProxy.json';
const pathProxyAdmin = '../artifacts/@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol/ProxyAdmin.json';
const pathTransparentProxy = '../artifacts/@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol/TransparentUpgradeableProxy.json';
const pathXagonZkEVMTimelock = '../artifacts/contracts/XagonZkEVMTimelock.sol/XagonZkEVMTimelock.json';
const pathXagonZkEVM = '../artifacts/contracts/XagonZkEVM.sol/XagonZkEVM.json';
const pathXagonZkEVMGlobalExitRoot = '../artifacts/contracts/XagonZkEVMGlobalExitRoot.sol/XagonZkEVMGlobalExitRoot.json';

const FflonkVerifier = require(pathFflonkVerifier);
const XagonZkEVMDeployer = require(pathXagonZkEVMDeployer);
const XagonZkEVMBridge = require(pathXagonZkEVMBridge);
const TransparentProxyOZUpgradeDep = require(pathTransparentProxyOZUpgradeDep);
const ProxyAdmin = require(pathProxyAdmin);
const TransparentProxy = require(pathTransparentProxy);


const etherscanURL = "https://etherscan.io/address/"
async function main() {
    // First verify not immutable conracts
    const mainnetProvider = new ethers.providers.JsonRpcProvider(`https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`);

    // FflonkVerifier
    expect(await mainnetProvider.getCode(deployMainnet.fflonkVerifierAddress))
        .to.be.equal(FflonkVerifier.deployedBytecode);
    console.log("FflonkVerifier was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + deployMainnet.fflonkVerifierAddress)
    console.log("Path file: ", path.join(__dirname, pathFflonkVerifier));
    console.log();

    // XagonZkEVMDeployer
    expect(await mainnetProvider.getCode(deployMainnet.xagonZkEVMDeployerAddress))
        .to.be.equal(XagonZkEVMDeployer.deployedBytecode);
    console.log("XagonZkEVMDeployer was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + deployMainnet.xagonZkEVMDeployerAddress)
    console.log("Path file: ", path.join(__dirname, pathXagonZkEVMDeployer));
    console.log();

    // Bridge
    // Since this contract is a proxy, we will need to verify the implementation
    const xagonZkEVMBridgeImpl = await getImplementationAddress(deployMainnet.xagonZkEVMBridgeAddress, mainnetProvider)

    expect(await mainnetProvider.getCode(xagonZkEVMBridgeImpl))
        .to.be.equal(XagonZkEVMBridge.deployedBytecode);
    console.log("XagonZkEVMBridgeAddress implementation was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + xagonZkEVMBridgeImpl)
    console.log("Path file: ", path.join(__dirname, pathXagonZkEVMBridge));
    console.log();

    // Check transparent Proxys
    expect(await mainnetProvider.getCode(deployMainnet.xagonZkEVMBridgeAddress))
        .to.be.equal(TransparentProxy.deployedBytecode);
    console.log("XagonZkEVMBridgeAddress proxy was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + deployMainnet.xagonZkEVMBridgeAddress);
    console.log("Path file: ", path.join(__dirname, pathTransparentProxy));
    console.log();

    // The other 3 contracts are immutables, therefore we will deploy them locally and check the btyecode against the deployed one

    // XagonZkEVMTimelock
    const XagonZkEVMTimelockFactory = await ethers.getContractFactory('XagonZkEVMTimelock');
    const timelockAddress = mainnetDeployParameters.timelockAddress; //not relevant to deployed bytecode
    const minDelayTimelock = mainnetDeployParameters.minDelayTimelock; //not relevant to deployed bytecode

    const XagonZkEVMTimelock = await XagonZkEVMTimelockFactory.deploy(
        minDelayTimelock,
        [timelockAddress],
        [timelockAddress],
        timelockAddress,
        deployMainnet.xagonZkEVMAddress,
    );
    XagonZkEVMTimelock.deployed()

    const deployedBytecodeXagonZkEVMTimelock = await ethers.provider.getCode(XagonZkEVMTimelock.address);
    expect(await mainnetProvider.getCode(deployMainnet.xagonZkEVMTimelockAddress))
        .to.be.equal(deployedBytecodeXagonZkEVMTimelock);
    console.log("Timelock was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + deployMainnet.xagonZkEVMTimelockAddress);
    console.log("Path file: ", path.join(__dirname, pathXagonZkEVMTimelock));
    console.log();

    // xagonZkEVMGlobalExitRoot
    const XagonZkEVMGlobalExitRootFactory = await ethers.getContractFactory('XagonZkEVMGlobalExitRoot');
    const xagonZkEVMGlobalExitRoot = await XagonZkEVMGlobalExitRootFactory.deploy(
        deployMainnet.xagonZkEVMAddress,
        deployMainnet.xagonZkEVMBridgeAddress
    );
    xagonZkEVMGlobalExitRoot.deployed()

    const deployedBytecodeGlobalExitRoot = await ethers.provider.getCode(xagonZkEVMGlobalExitRoot.address);
    const xagonZkEVMGlobalImpl = await getImplementationAddress(deployMainnet.xagonZkEVMGlobalExitRootAddress, mainnetProvider)

    expect(await mainnetProvider.getCode(xagonZkEVMGlobalImpl))
        .to.be.equal(deployedBytecodeGlobalExitRoot);
    console.log("XagonZkEVMGlobalExitRoot implementation was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + xagonZkEVMGlobalImpl);
    console.log("Path file: ", path.join(__dirname, pathXagonZkEVMGlobalExitRoot));
    console.log();

    // Check transparent Proxys
    expect(await mainnetProvider.getCode(deployMainnet.xagonZkEVMGlobalExitRootAddress))
        .to.be.equal(TransparentProxyOZUpgradeDep.deployedBytecode);
    console.log("XagonZkEVMGlobalExitRoot proxy was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + deployMainnet.xagonZkEVMGlobalExitRootAddress);
    console.log("Path file: ", path.join(__dirname, pathTransparentProxyOZUpgradeDep));
    console.log();

    // XagonZkEVM
    const mainnetChainID = mainnetDeployParameters.chainID;
    const mainnetForkID = mainnetDeployParameters.forkID;
    const maticAddress = mainnetDeployParameters.maticTokenAddress;

    const XagonZkEVMFactory = await ethers.getContractFactory('XagonZkEVM');
    const xagonZkEVMContract = await XagonZkEVMFactory.deploy(
        deployMainnet.xagonZkEVMGlobalExitRootAddress,
        maticAddress,
        deployMainnet.fflonkVerifierAddress,
        deployMainnet.xagonZkEVMBridgeAddress,
        mainnetChainID,
        mainnetForkID,
    );
    xagonZkEVMContract.deployed()

    const deployedBytecodeXagonZkEVM = await ethers.provider.getCode(xagonZkEVMContract.address);
    const xagonZkEVMImpl = await getImplementationAddress(deployMainnet.xagonZkEVMAddress, mainnetProvider)

    expect(await mainnetProvider.getCode(xagonZkEVMImpl))
        .to.be.equal(deployedBytecodeXagonZkEVM);
    console.log("XagonZkEVMAddress implementation was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + xagonZkEVMImpl);
    console.log("Path file: ", path.join(__dirname, pathXagonZkEVM));
    console.log();
    
    // Check transparent Proxys
    expect(await mainnetProvider.getCode(deployMainnet.xagonZkEVMAddress))
        .to.be.equal(TransparentProxyOZUpgradeDep.deployedBytecode);
    console.log("XagonZkEVMAddress proxy was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + deployMainnet.xagonZkEVMAddress);
    console.log("Path file: ", path.join(__dirname, pathTransparentProxyOZUpgradeDep));
    console.log();

    // Check proxy Admin
    const xagonZkEVMBridgeAdmin = await getProxyAdminAddress(deployMainnet.xagonZkEVMBridgeAddress, mainnetProvider);
    const xagonZkEVMAdmin = await getProxyAdminAddress(deployMainnet.xagonZkEVMAddress, mainnetProvider);
    const xagonZkEVMGlobalExitRootAdmin = await getProxyAdminAddress(deployMainnet.xagonZkEVMGlobalExitRootAddress, mainnetProvider);

    expect(xagonZkEVMBridgeAdmin).to.be.equal(xagonZkEVMAdmin);
    expect(xagonZkEVMAdmin).to.be.equal(xagonZkEVMGlobalExitRootAdmin);
    expect(await mainnetProvider.getCode(xagonZkEVMAdmin))
        .to.be.equal(ProxyAdmin.deployedBytecode);
    console.log("ProxyAdmin proxy was correctly verified")
    console.log("Etherscan URL: ", etherscanURL + xagonZkEVMAdmin);
    console.log("Path file: ", path.join(__dirname, pathProxyAdmin));
    console.log();

    // Assert genesis is the same as the provided in the document
    let mainnetXagonZkVEM = (await ethers.getContractFactory('XagonZkEVM', mainnetProvider)).attach(deployMainnet.xagonZkEVMAddress);
    mainnetXagonZkVEM = mainnetXagonZkVEM.connect(mainnetProvider);
    expect(await mainnetXagonZkVEM.batchNumToStateRoot(0)).to.be.equal(deployMainnet.genesisRoot);
    console.log("Genesis root was correctly verified:",deployMainnet.genesisRoot)

}
// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

//     bytes32 internal constant _ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
//     bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
const adminSlot = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function getImplementationAddress(proxyAddress, provider) {
    const implementationAddress = await provider.getStorageAt(proxyAddress, implSlot);
    return `0x${implementationAddress.slice(2 + (32 * 2 - 40))}`
}

async function getProxyAdminAddress(proxyAddress, provider) {
    const adminAddress = await provider.getStorageAt(proxyAddress, adminSlot);
    return `0x${adminAddress.slice(2 + (32 * 2 - 40))}`
}
