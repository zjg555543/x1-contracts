/* eslint-disable no-plusplus, no-await-in-loop */
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('Xagon ZK-EVM TestnetV2', () => {
    let deployer;
    let trustedAggregator;
    let trustedSequencer;
    let admin;

    let verifierContract;
    let xagonZkEVMBridgeContract;
    let xagonZkEVMContract;
    let maticTokenContract;
    let xagonZkEVMGlobalExitRoot;

    const maticTokenName = 'Matic Token';
    const maticTokenSymbol = 'MATIC';
    const maticTokenInitialBalance = ethers.utils.parseEther('20000000');

    const genesisRoot = '0x0000000000000000000000000000000000000000000000000000000000000001';

    const networkIDMainnet = 0;
    const urlSequencer = 'http://zkevm-json-rpc:8123';
    const chainID = 1000;
    const networkName = 'zkevm';
    const version = '0.0.1';
    const forkID = 0;
    const pendingStateTimeoutDefault = 100;
    const trustedAggregatorTimeoutDefault = 10;
    let firstDeployment = true;

    beforeEach('Deploy contract', async () => {
        upgrades.silenceWarnings();

        // load signers
        [deployer, trustedAggregator, trustedSequencer, admin] = await ethers.getSigners();

        // deploy mock verifier
        const VerifierRollupHelperFactory = await ethers.getContractFactory(
            'VerifierRollupHelperMock',
        );
        verifierContract = await VerifierRollupHelperFactory.deploy();

        // deploy MATIC
        const maticTokenFactory = await ethers.getContractFactory('ERC20PermitMock');
        maticTokenContract = await maticTokenFactory.deploy(
            maticTokenName,
            maticTokenSymbol,
            deployer.address,
            maticTokenInitialBalance,
        );
        await maticTokenContract.deployed();

        /*
         * deploy global exit root manager
         * In order to not have trouble with nonce deploy first proxy admin
         */
        await upgrades.deployProxyAdmin();
        if ((await upgrades.admin.getInstance()).address !== '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0') {
            firstDeployment = false;
        }
        const nonceProxyBridge = Number((await ethers.provider.getTransactionCount(deployer.address))) + (firstDeployment ? 3 : 2);
        const nonceProxyZkevm = nonceProxyBridge + 2; // Always have to redeploy impl since the xagonZkEVMGlobalExitRoot address changes

        const precalculateBridgeAddress = ethers.utils.getContractAddress({ from: deployer.address, nonce: nonceProxyBridge });
        const precalculateZkevmAddress = ethers.utils.getContractAddress({ from: deployer.address, nonce: nonceProxyZkevm });
        firstDeployment = false;

        const XagonZkEVMGlobalExitRootFactory = await ethers.getContractFactory('XagonZkEVMGlobalExitRoot');
        xagonZkEVMGlobalExitRoot = await upgrades.deployProxy(XagonZkEVMGlobalExitRootFactory, [], {
            initializer: false,
            constructorArgs: [precalculateZkevmAddress, precalculateBridgeAddress],
            unsafeAllow: ['constructor', 'state-variable-immutable'],
        });

        // deploy XagonZkEVMBridge
        const xagonZkEVMBridgeFactory = await ethers.getContractFactory('XagonZkEVMBridge');
        xagonZkEVMBridgeContract = await upgrades.deployProxy(xagonZkEVMBridgeFactory, [], { initializer: false });

        // deploy XagonZkEVMTestnet
        const XagonZkEVMFactory = await ethers.getContractFactory('XagonZkEVMTestnetV2');
        xagonZkEVMContract = await upgrades.deployProxy(XagonZkEVMFactory, [], {
            initializer: false,
            constructorArgs: [
                xagonZkEVMGlobalExitRoot.address,
                maticTokenContract.address,
                verifierContract.address,
                xagonZkEVMBridgeContract.address,
                chainID,
                forkID,
            ],
            unsafeAllow: ['constructor', 'state-variable-immutable'],
        });

        expect(precalculateBridgeAddress).to.be.equal(xagonZkEVMBridgeContract.address);
        expect(precalculateZkevmAddress).to.be.equal(xagonZkEVMContract.address);

        await xagonZkEVMBridgeContract.initialize(networkIDMainnet, xagonZkEVMGlobalExitRoot.address, xagonZkEVMContract.address);
        await xagonZkEVMContract.initialize(
            {
                admin: admin.address,
                trustedSequencer: trustedSequencer.address,
                pendingStateTimeout: pendingStateTimeoutDefault,
                trustedAggregator: trustedAggregator.address,
                trustedAggregatorTimeout: trustedAggregatorTimeoutDefault,
            },
            genesisRoot,
            urlSequencer,
            networkName,
            version,
        );

        // fund sequencer address with Matic tokens
        await maticTokenContract.transfer(trustedSequencer.address, ethers.utils.parseEther('1000'));
    });

    it('should check the constructor parameters', async () => {
        expect(await xagonZkEVMContract.version()).to.be.equal(0);
    });

    it('should check updateVersion', async () => {
        const newVersionString = '0.0.2';

        /*
         * const lastVerifiedBatch = 0;
         * await expect(xagonZkEVMContract.updateVersion(newVersionString))
         *     .to.emit(xagonZkEVMContract, 'UpdateZkEVMVersion').withArgs(lastVerifiedBatch, forkID, newVersionString);
         */

        await expect(xagonZkEVMContract.updateVersion(newVersionString))
            .to.be.revertedWith('VersionAlreadyUpdated');

        // expect(await xagonZkEVMContract.version()).to.be.equal(1);
    });
});
