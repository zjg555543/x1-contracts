/* eslint-disable no-await-in-loop, no-use-before-define, no-lonely-if, import/no-dynamic-require, global-require */
/* eslint-disable no-console, no-inner-declarations, no-undef, import/no-unresolved, no-restricted-syntax */
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { create2Deployment } = require('./helpers/deployment-helpers');

const pathOutputJson = path.join(__dirname, './deploy_output.json');
const pathOngoingDeploymentJson = path.join(__dirname, './deploy_ongoing.json');

const deployParameters = require('./deploy_parameters.json');
const genesis = require('./genesis.json');

const pathOZUpgradability = path.join(__dirname, `../.openzeppelin/${process.env.HARDHAT_NETWORK}.json`);

async function main() {
    // Check that there's no previous OZ deployment
    if (fs.existsSync(pathOZUpgradability)) {
        throw new Error(`There's upgradability information from previous deployments, it's mandatory to erase them before start a new one, path: ${pathOZUpgradability}`);
    }

    // Check if there's an ongoing deployment
    let ongoingDeployment = {};
    if (fs.existsSync(pathOngoingDeploymentJson)) {
        ongoingDeployment = require(pathOngoingDeploymentJson);
    }

    // Constant variables
    const networkIDMainnet = 0;
    const attemptsDeployProxy = 20;

    /*
     * Check deploy parameters
     * Check that every necessary parameter is fullfilled
     */
    const mandatoryDeploymentParameters = [
        'realVerifier',
        'trustedSequencerURL',
        'networkName',
        'version',
        'trustedSequencer',
        'chainID',
        'admin',
        'trustedAggregator',
        'trustedAggregatorTimeout',
        'pendingStateTimeout',
        'forkID',
        'zkEVMOwner',
        'timelockAddress',
        'minDelayTimelock',
        'salt',
        'zkEVMDeployerAddress',
        'maticTokenAddress',
    ];

    for (const parameterName of mandatoryDeploymentParameters) {
        if (deployParameters[parameterName] === undefined || deployParameters[parameterName] === '') {
            throw new Error(`Missing parameter: ${parameterName}`);
        }
    }

    const {
        realVerifier,
        trustedSequencerURL,
        networkName,
        version,
        trustedSequencer,
        chainID,
        admin,
        trustedAggregator,
        trustedAggregatorTimeout,
        pendingStateTimeout,
        forkID,
        zkEVMOwner,
        timelockAddress,
        minDelayTimelock,
        salt,
        zkEVMDeployerAddress,
        maticTokenAddress,
    } = deployParameters;

    // Load provider
    let currentProvider = ethers.provider;
    if (deployParameters.multiplierGas || deployParameters.maxFeePerGas) {
        if (process.env.HARDHAT_NETWORK !== 'hardhat') {
            currentProvider = new ethers.providers.JsonRpcProvider(`https://${process.env.HARDHAT_NETWORK}.infura.io/v3/${process.env.INFURA_PROJECT_ID}`);
            if (deployParameters.maxPriorityFeePerGas && deployParameters.maxFeePerGas) {
                console.log(`Hardcoded gas used: MaxPriority${deployParameters.maxPriorityFeePerGas} gwei, MaxFee${deployParameters.maxFeePerGas} gwei`);
                const FEE_DATA = {
                    maxFeePerGas: ethers.utils.parseUnits(deployParameters.maxFeePerGas, 'gwei'),
                    maxPriorityFeePerGas: ethers.utils.parseUnits(deployParameters.maxPriorityFeePerGas, 'gwei'),
                };
                currentProvider.getFeeData = async () => FEE_DATA;
            } else {
                console.log('Multiplier gas used: ', deployParameters.multiplierGas);
                async function overrideFeeData() {
                    const feedata = await ethers.provider.getFeeData();
                    return {
                        maxFeePerGas: feedata.maxFeePerGas.mul(deployParameters.multiplierGas).div(1000),
                        maxPriorityFeePerGas: feedata.maxPriorityFeePerGas.mul(deployParameters.multiplierGas).div(1000),
                    };
                }
                currentProvider.getFeeData = overrideFeeData;
            }
        }
    }

    // Load deployer
    let deployer;
    if (deployParameters.deployerPvtKey) {
        deployer = new ethers.Wallet(deployParameters.deployerPvtKey, currentProvider);
        console.log('Using pvtKey deployer with address: ', deployer.address);
    } else if (process.env.MNEMONIC) {
        deployer = ethers.Wallet.fromMnemonic(process.env.MNEMONIC, 'm/44\'/60\'/0\'/0/0').connect(currentProvider);
        console.log('Using MNEMONIC deployer with address: ', deployer.address);
    } else {
        [deployer] = (await ethers.getSigners());
    }

    // Load zkEVM deployer
    const PolgonZKEVMDeployerFactory = await ethers.getContractFactory('XagonZkEVMDeployer', deployer);
    const zkEVMDeployerContract = PolgonZKEVMDeployerFactory.attach(zkEVMDeployerAddress);

    // check deployer is the owner of the deployer
    if (await deployer.provider.getCode(zkEVMDeployerContract.address) === '0x') {
        throw new Error('zkEVM deployer contract is not deployed');
    }
    expect(deployer.address).to.be.equal(await zkEVMDeployerContract.owner());

    let verifierContract;
    if (!ongoingDeployment.verifierContract) {
        if (realVerifier === true) {
            const VerifierRollup = await ethers.getContractFactory('FflonkVerifier', deployer);
            verifierContract = await VerifierRollup.deploy();
            await verifierContract.deployed();
        } else {
            const VerifierRollupHelperFactory = await ethers.getContractFactory('VerifierRollupHelperMock', deployer);
            verifierContract = await VerifierRollupHelperFactory.deploy();
            await verifierContract.deployed();
        }
        console.log('#######################\n');
        console.log('Verifier deployed to:', verifierContract.address);

        // save an ongoing deployment
        ongoingDeployment.verifierContract = verifierContract.address;
        fs.writeFileSync(pathOngoingDeploymentJson, JSON.stringify(ongoingDeployment, null, 1));
    } else {
        console.log('Verifier already deployed on: ', ongoingDeployment.verifierContract);
        const VerifierRollupFactory = await ethers.getContractFactory('FflonkVerifier', deployer);
        verifierContract = VerifierRollupFactory.attach(ongoingDeployment.verifierContract);
    }

    /*
     * Deploy Bridge
     * Deploy admin --> implementation --> proxy
     */

    // Deploy proxy admin:
    const proxyAdminFactory = await ethers.getContractFactory('ProxyAdmin', deployer);
    const deployTransactionAdmin = (proxyAdminFactory.getDeployTransaction()).data;
    const dataCallAdmin = proxyAdminFactory.interface.encodeFunctionData('transferOwnership', [deployer.address]);
    const [proxyAdminAddress, isProxyAdminDeployed] = await create2Deployment(
        zkEVMDeployerContract,
        salt,
        deployTransactionAdmin,
        dataCallAdmin,
        deployer,
    );

    if (isProxyAdminDeployed) {
        console.log('#######################\n');
        console.log('Proxy admin deployed to:', proxyAdminAddress);
    } else {
        console.log('#######################\n');
        console.log('Proxy admin was already deployed to:', proxyAdminAddress);
    }

    // Deploy implementation XagonZkEVMBridge
    const xagonZkEVMBridgeFactory = await ethers.getContractFactory('XagonZkEVMBridge', deployer);
    const deployTransactionBridge = (xagonZkEVMBridgeFactory.getDeployTransaction()).data;
    const dataCallNull = null;
    // Mandatory to override the gasLimit since the estimation with create are mess up D:
    const overrideGasLimit = ethers.BigNumber.from(5500000);
    const [bridgeImplementationAddress, isBridgeImplDeployed] = await create2Deployment(
        zkEVMDeployerContract,
        salt,
        deployTransactionBridge,
        dataCallNull,
        deployer,
        overrideGasLimit,
    );

    if (isBridgeImplDeployed) {
        console.log('#######################\n');
        console.log('bridge impl deployed to:', bridgeImplementationAddress);
    } else {
        console.log('#######################\n');
        console.log('bridge impl was already deployed to:', bridgeImplementationAddress);
    }

    /*
     * deploy proxy
     * Do not initialize directly the proxy since we want to deploy the same code on L2 and this will alter the bytecode deployed of the proxy
     */
    const transparentProxyFactory = await ethers.getContractFactory('TransparentUpgradeableProxy', deployer);
    const initializeEmptyDataProxy = '0x';
    const deployTransactionProxy = (transparentProxyFactory.getDeployTransaction(
        bridgeImplementationAddress,
        proxyAdminAddress,
        initializeEmptyDataProxy,
    )).data;

    // Nonce globalExitRoot: currentNonce + 1 (deploy bridge proxy) + 1(impl globalExitRoot) = +2
    const nonceProxyGlobalExitRoot = Number((await ethers.provider.getTransactionCount(deployer.address))) + 2;
    // nonceProxyZkevm :Nonce globalExitRoot + 1 (proxy globalExitRoot) + 1 (impl Zkevm) = +2
    const nonceProxyZkevm = nonceProxyGlobalExitRoot + 2;

    let precalculateGLobalExitRootAddress; let
        precalculateZkevmAddress;

    // Check if the contract is already deployed
    if (ongoingDeployment.xagonZkEVMGlobalExitRoot && ongoingDeployment.xagonZkEVMContract) {
        precalculateGLobalExitRootAddress = ongoingDeployment.xagonZkEVMGlobalExitRoot;
        precalculateZkevmAddress = ongoingDeployment.xagonZkEVMContract;
    } else {
        // If both are not deployed, it's better to deploy them both again
        delete ongoingDeployment.xagonZkEVMGlobalExitRoot;
        delete ongoingDeployment.xagonZkEVMContract;
        fs.writeFileSync(pathOngoingDeploymentJson, JSON.stringify(ongoingDeployment, null, 1));

        // Contracts are not deployed, normal deployment
        precalculateGLobalExitRootAddress = ethers.utils.getContractAddress({ from: deployer.address, nonce: nonceProxyGlobalExitRoot });
        precalculateZkevmAddress = ethers.utils.getContractAddress({ from: deployer.address, nonce: nonceProxyZkevm });
    }

    const dataCallProxy = xagonZkEVMBridgeFactory.interface.encodeFunctionData(
        'initialize',
        [
            networkIDMainnet,
            precalculateGLobalExitRootAddress,
            precalculateZkevmAddress,
        ],
    );
    const [proxyBridgeAddress, isBridgeProxyDeployed] = await create2Deployment(
        zkEVMDeployerContract,
        salt,
        deployTransactionProxy,
        dataCallProxy,
        deployer,
    );
    const xagonZkEVMBridgeContract = xagonZkEVMBridgeFactory.attach(proxyBridgeAddress);

    if (isBridgeProxyDeployed) {
        console.log('#######################\n');
        console.log('XagonZkEVMBridge deployed to:', xagonZkEVMBridgeContract.address);
    } else {
        console.log('#######################\n');
        console.log('XagonZkEVMBridge was already deployed to:', xagonZkEVMBridgeContract.address);

        // If it was already deployed, check that the initialized calldata matches the actual deployment
        expect(precalculateGLobalExitRootAddress).to.be.equal(await xagonZkEVMBridgeContract.globalExitRootManager());
        expect(precalculateZkevmAddress).to.be.equal(await xagonZkEVMBridgeContract.xagonZkEVMaddress());
    }

    console.log('\n#######################');
    console.log('#####    Checks XagonZkEVMBridge   #####');
    console.log('#######################');
    console.log('XagonZkEVMGlobalExitRootAddress:', await xagonZkEVMBridgeContract.globalExitRootManager());
    console.log('networkID:', await xagonZkEVMBridgeContract.networkID());
    console.log('zkEVMaddress:', await xagonZkEVMBridgeContract.xagonZkEVMaddress());

    // Import OZ manifest the deployed contracts, its enough to import just the proxy, the rest are imported automatically (admin/impl)
    await upgrades.forceImport(proxyBridgeAddress, xagonZkEVMBridgeFactory, 'transparent');

    /*
     *Deployment Global exit root manager
     */
    let xagonZkEVMGlobalExitRoot;
    const XagonZkEVMGlobalExitRootFactory = await ethers.getContractFactory('XagonZkEVMGlobalExitRoot', deployer);
    if (!ongoingDeployment.xagonZkEVMGlobalExitRoot) {
        for (let i = 0; i < attemptsDeployProxy; i++) {
            try {
                xagonZkEVMGlobalExitRoot = await upgrades.deployProxy(XagonZkEVMGlobalExitRootFactory, [], {
                    initializer: false,
                    constructorArgs: [precalculateZkevmAddress, proxyBridgeAddress],
                    unsafeAllow: ['constructor', 'state-variable-immutable'],
                });
                break;
            } catch (error) {
                console.log(`attempt ${i}`);
                console.log('upgrades.deployProxy of xagonZkEVMGlobalExitRoot ', error.message);
            }

            // reach limits of attempts
            if (i + 1 === attemptsDeployProxy) {
                throw new Error('xagonZkEVMGlobalExitRoot contract has not been deployed');
            }
        }

        expect(precalculateGLobalExitRootAddress).to.be.equal(xagonZkEVMGlobalExitRoot.address);

        console.log('#######################\n');
        console.log('xagonZkEVMGlobalExitRoot deployed to:', xagonZkEVMGlobalExitRoot.address);

        // save an ongoing deployment
        ongoingDeployment.xagonZkEVMGlobalExitRoot = xagonZkEVMGlobalExitRoot.address;
        fs.writeFileSync(pathOngoingDeploymentJson, JSON.stringify(ongoingDeployment, null, 1));
    } else {
        // sanity check
        expect(precalculateGLobalExitRootAddress).to.be.equal(xagonZkEVMGlobalExitRoot.address);
        // Expect the precalculate address matches de onogin deployment
        xagonZkEVMGlobalExitRoot = XagonZkEVMGlobalExitRootFactory.attach(ongoingDeployment.xagonZkEVMGlobalExitRoot);

        console.log('#######################\n');
        console.log('xagonZkEVMGlobalExitRoot already deployed on: ', ongoingDeployment.xagonZkEVMGlobalExitRoot);

        // Import OZ manifest the deployed contracts, its enough to import just the proyx, the rest are imported automatically (admin/impl)
        await upgrades.forceImport(ongoingDeployment.xagonZkEVMGlobalExitRoot, XagonZkEVMGlobalExitRootFactory, 'transparent');

        // Check against current deployment
        expect(xagonZkEVMBridgeContract.address).to.be.equal(await xagonZkEVMBridgeContract.bridgeAddress());
        expect(precalculateZkevmAddress).to.be.equal(await xagonZkEVMBridgeContract.rollupAddress());
    }

    // deploy XagonZkEVMM
    const genesisRootHex = genesis.root;

    console.log('\n#######################');
    console.log('##### Deployment Xagon ZK-EVM #####');
    console.log('#######################');
    console.log('deployer:', deployer.address);
    console.log('XagonZkEVMGlobalExitRootAddress:', xagonZkEVMGlobalExitRoot.address);
    console.log('maticTokenAddress:', maticTokenAddress);
    console.log('verifierAddress:', verifierContract.address);
    console.log('xagonZkEVMBridgeContract:', xagonZkEVMBridgeContract.address);

    console.log('admin:', admin);
    console.log('chainID:', chainID);
    console.log('trustedSequencer:', trustedSequencer);
    console.log('pendingStateTimeout:', pendingStateTimeout);
    console.log('trustedAggregator:', trustedAggregator);
    console.log('trustedAggregatorTimeout:', trustedAggregatorTimeout);

    console.log('genesisRoot:', genesisRootHex);
    console.log('trustedSequencerURL:', trustedSequencerURL);
    console.log('networkName:', networkName);
    console.log('forkID:', forkID);

    const XagonZkEVMFactory = await ethers.getContractFactory('XagonZkEVM', deployer);

    let xagonZkEVMContract;
    let deploymentBlockNumber;
    if (!ongoingDeployment.xagonZkEVMContract) {
        for (let i = 0; i < attemptsDeployProxy; i++) {
            try {
                xagonZkEVMContract = await upgrades.deployProxy(
                    XagonZkEVMFactory,
                    [
                        {
                            admin,
                            trustedSequencer,
                            pendingStateTimeout,
                            trustedAggregator,
                            trustedAggregatorTimeout,
                        },
                        genesisRootHex,
                        trustedSequencerURL,
                        networkName,
                        version,
                    ],
                    {
                        constructorArgs: [
                            xagonZkEVMGlobalExitRoot.address,
                            maticTokenAddress,
                            verifierContract.address,
                            xagonZkEVMBridgeContract.address,
                            chainID,
                            forkID,
                        ],
                        unsafeAllow: ['constructor', 'state-variable-immutable'],
                    },
                );
                break;
            } catch (error) {
                console.log(`attempt ${i}`);
                console.log('upgrades.deployProxy of xagonZkEVMContract ', error.message);
            }

            // reach limits of attempts
            if (i + 1 === attemptsDeployProxy) {
                throw new Error('XagonZkEVM contract has not been deployed');
            }
        }

        expect(precalculateZkevmAddress).to.be.equal(xagonZkEVMContract.address);

        console.log('#######################\n');
        console.log('xagonZkEVMContract deployed to:', xagonZkEVMContract.address);

        // save an ongoing deployment
        ongoingDeployment.xagonZkEVMContract = xagonZkEVMContract.address;
        fs.writeFileSync(pathOngoingDeploymentJson, JSON.stringify(ongoingDeployment, null, 1));

        // Transfer ownership of xagonZkEVMContract
        if (zkEVMOwner !== deployer.address) {
            await (await xagonZkEVMContract.transferOwnership(zkEVMOwner)).wait();
        }

        deploymentBlockNumber = (await xagonZkEVMContract.deployTransaction.wait()).blockNumber;
    } else {
        // Expect the precalculate address matches de onogin deployment, sanity check
        expect(precalculateZkevmAddress).to.be.equal(ongoingDeployment.xagonZkEVMContract);
        xagonZkEVMContract = XagonZkEVMFactory.attach(ongoingDeployment.xagonZkEVMContract);

        console.log('#######################\n');
        console.log('xagonZkEVMContract already deployed on: ', ongoingDeployment.xagonZkEVMContract);

        // Import OZ manifest the deployed contracts, its enough to import just the proyx, the rest are imported automatically ( admin/impl)
        await upgrades.forceImport(ongoingDeployment.xagonZkEVMContract, XagonZkEVMFactory, 'transparent');

        const zkEVMOwnerContract = await xagonZkEVMContract.owner();
        if (zkEVMOwnerContract === deployer.address) {
            // Transfer ownership of xagonZkEVMContract
            if (zkEVMOwner !== deployer.address) {
                await (await xagonZkEVMContract.transferOwnership(zkEVMOwner)).wait();
            }
        } else {
            expect(zkEVMOwner).to.be.equal(zkEVMOwnerContract);
        }
        deploymentBlockNumber = 0;
    }

    console.log('\n#######################');
    console.log('#####    Checks  XagonZkEVM  #####');
    console.log('#######################');
    console.log('XagonZkEVMGlobalExitRootAddress:', await xagonZkEVMContract.globalExitRootManager());
    console.log('maticTokenAddress:', await xagonZkEVMContract.matic());
    console.log('verifierAddress:', await xagonZkEVMContract.rollupVerifier());
    console.log('xagonZkEVMBridgeContract:', await xagonZkEVMContract.bridgeAddress());

    console.log('admin:', await xagonZkEVMContract.admin());
    console.log('chainID:', await xagonZkEVMContract.chainID());
    console.log('trustedSequencer:', await xagonZkEVMContract.trustedSequencer());
    console.log('pendingStateTimeout:', await xagonZkEVMContract.pendingStateTimeout());
    console.log('trustedAggregator:', await xagonZkEVMContract.trustedAggregator());
    console.log('trustedAggregatorTimeout:', await xagonZkEVMContract.trustedAggregatorTimeout());

    console.log('genesiRoot:', await xagonZkEVMContract.batchNumToStateRoot(0));
    console.log('trustedSequencerURL:', await xagonZkEVMContract.trustedSequencerURL());
    console.log('networkName:', await xagonZkEVMContract.networkName());
    console.log('owner:', await xagonZkEVMContract.owner());
    console.log('forkID:', await xagonZkEVMContract.forkID());

    // Assert admin address
    expect(await upgrades.erc1967.getAdminAddress(precalculateZkevmAddress)).to.be.equal(proxyAdminAddress);
    expect(await upgrades.erc1967.getAdminAddress(precalculateGLobalExitRootAddress)).to.be.equal(proxyAdminAddress);
    expect(await upgrades.erc1967.getAdminAddress(proxyBridgeAddress)).to.be.equal(proxyAdminAddress);

    const proxyAdminInstance = proxyAdminFactory.attach(proxyAdminAddress);
    const proxyAdminOwner = await proxyAdminInstance.owner();
    const timelockContractFactory = await ethers.getContractFactory('XagonZkEVMTimelock', deployer);

    // TODO test stop here

    let timelockContract;
    if (proxyAdminOwner !== deployer.address) {
        // Check if there's a timelock deployed there that match the current deployment
        timelockContract = timelockContractFactory.attach(proxyAdminOwner);
        expect(precalculateZkevmAddress).to.be.equal(await timelockContract.xagonZkEVM());

        console.log('#######################\n');
        console.log(
            'Xagon timelockContract already deployed to:',
            timelockContract.address,
        );
    } else {
        // deploy timelock
        console.log('\n#######################');
        console.log('##### Deployment TimelockContract  #####');
        console.log('#######################');
        console.log('minDelayTimelock:', minDelayTimelock);
        console.log('timelockAddress:', timelockAddress);
        console.log('zkEVMAddress:', xagonZkEVMContract.address);
        timelockContract = await timelockContractFactory.deploy(
            minDelayTimelock,
            [timelockAddress],
            [timelockAddress],
            timelockAddress,
            xagonZkEVMContract.address,
        );
        await timelockContract.deployed();
        console.log('#######################\n');
        console.log(
            'Xagon timelockContract deployed to:',
            timelockContract.address,
        );

        // Transfer ownership of the proxyAdmin to timelock
        const proxyAdminContract = proxyAdminFactory.attach(proxyAdminAddress);
        await (await proxyAdminContract.transferOwnership(timelockContract.address)).wait();
    }

    console.log('\n#######################');
    console.log('#####  Checks TimelockContract  #####');
    console.log('#######################');
    console.log('minDelayTimelock:', await timelockContract.getMinDelay());
    console.log('xagonZkEVM:', await timelockContract.xagonZkEVM());

    const outputJson = {
        xagonZkEVMAddress: xagonZkEVMContract.address,
        xagonZkEVMBridgeAddress: xagonZkEVMBridgeContract.address,
        xagonZkEVMGlobalExitRootAddress: xagonZkEVMGlobalExitRoot.address,
        maticTokenAddress,
        verifierAddress: verifierContract.address,
        zkEVMDeployerContract: zkEVMDeployerContract.address,
        deployerAddress: deployer.address,
        timelockContractAddress: timelockContract.address,
        deploymentBlockNumber,
        genesisRoot: genesisRootHex,
        trustedSequencer,
        trustedSequencerURL,
        chainID,
        networkName,
        admin,
        trustedAggregator,
        proxyAdminAddress,
        forkID,
        salt,
        version,
    };
    fs.writeFileSync(pathOutputJson, JSON.stringify(outputJson, null, 1));

    // Remove ongoing deployment
    fs.unlinkSync(pathOngoingDeploymentJson);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
