const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

// OZ test functions
function genOperation(target, value, data, predecessor, salt) {
    const id = ethers.utils.solidityKeccak256([
        'address',
        'uint256',
        'bytes',
        'uint256',
        'bytes32',
    ], [
        target,
        value,
        data,
        predecessor,
        salt,
    ]);
    return {
        id, target, value, data, predecessor, salt,
    };
}

describe('Xagon ZK-EVM', () => {
    let deployer;
    let trustedAggregator;
    let trustedSequencer;
    let admin;

    let timelockContract;
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
    const pendingStateTimeoutDefault = 10;
    const trustedAggregatorTimeoutDefault = 10;
    let firstDeployment = true;

    const minDelay = 60 * 60; // 1 hout
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

        // deploy XagonZkEVMMock
        const XagonZkEVMFactory = await ethers.getContractFactory('XagonZkEVMMock');
        xagonZkEVMContract = await upgrades.deployProxy(XagonZkEVMFactory, [], {
            initializer: false,
            constructorArgs: [
                xagonZkEVMGlobalExitRoot.address,
                maticTokenContract.address,
                verifierContract.address,
                xagonZkEVMBridgeContract.address,
                chainID,
                0,
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

        const proposers = [deployer.address];
        const executors = [deployer.address];
        const adminAddress = deployer.address;

        const timelockContractFactory = await ethers.getContractFactory('XagonZkEVMTimelock');
        timelockContract = await timelockContractFactory.deploy(minDelay, proposers, executors, adminAddress, xagonZkEVMContract.address);
        await timelockContract.deployed();
    });

    it('Should upgrade brdige correctly', async () => {
        // Upgrade the contract
        const xagonZkEVMBridgeFactoryV2 = await ethers.getContractFactory('XagonZkEVMBridgeMock');
        const xagonZkEVMBridgeContractV2 = xagonZkEVMBridgeFactoryV2.attach(xagonZkEVMBridgeContract.address);

        // Check that is the v0 contract
        await expect(xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.reverted;

        // Upgrade the contract
        await upgrades.upgradeProxy(xagonZkEVMBridgeContract.address, xagonZkEVMBridgeFactoryV2);

        await expect(await xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.equal(0);
    });

    it('Should transferOwnership of the proxyAdmin to the timelock', async () => {
        // Upgrade the contract
        const xagonZkEVMBridgeFactoryV2 = await ethers.getContractFactory('XagonZkEVMBridgeMock');
        const xagonZkEVMBridgeContractV2 = xagonZkEVMBridgeFactoryV2.attach(xagonZkEVMBridgeContract.address);

        // Check that is the v0 contract
        await expect(xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.reverted;

        // Transfer ownership to timelock
        await upgrades.admin.transferProxyAdminOwnership(timelockContract.address);

        // Can't upgrade the contract since it does not have the ownership
        await expect(upgrades.upgradeProxy(xagonZkEVMBridgeContract.address, xagonZkEVMBridgeFactoryV2))
            .to.be.reverted;

        const implBridgeV2Address = await upgrades.prepareUpgrade(xagonZkEVMBridgeContract.address, xagonZkEVMBridgeFactoryV2);
        const proxyAdmin = await upgrades.admin.getInstance();

        // Use timelock
        const operation = genOperation(
            proxyAdmin.address,
            0,
            proxyAdmin.interface.encodeFunctionData(
                'upgrade',
                [xagonZkEVMBridgeContract.address,
                    implBridgeV2Address],
            ),
            ethers.constants.HashZero,
            ethers.constants.HashZero,
        );

        // Schedule operation
        await timelockContract.schedule(
            operation.target,
            operation.value,
            operation.data,
            operation.predecessor,
            operation.salt,
            minDelay,
        );

        // Can't upgrade because the timeout didint expire yet
        await expect(timelockContract.execute(
            operation.target,
            operation.value,
            operation.data,
            operation.predecessor,
            operation.salt,
        )).to.be.revertedWith('TimelockController: operation is not ready');

        // Check that is the v0 contract
        await expect(xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.reverted;

        await ethers.provider.send('evm_increaseTime', [minDelay]);
        await timelockContract.execute(
            operation.target,
            operation.value,
            operation.data,
            operation.predecessor,
            operation.salt,
        );

        await expect(await xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.equal(0);
    });

    it('Should check thet in emergency state the minDelay is 0', async () => {
        // Upgrade the contract
        const xagonZkEVMBridgeFactoryV2 = await ethers.getContractFactory('XagonZkEVMBridgeMock');
        const xagonZkEVMBridgeContractV2 = xagonZkEVMBridgeFactoryV2.attach(xagonZkEVMBridgeContract.address);

        // Check that is the v0 contract
        await expect(xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.reverted;

        // Transfer ownership to timelock

        // Can't upgrade the contract since it does not have the ownership
        await expect(upgrades.upgradeProxy(xagonZkEVMBridgeContract.address, xagonZkEVMBridgeFactoryV2))
            .to.be.reverted;

        const implBridgeV2Address = await upgrades.prepareUpgrade(xagonZkEVMBridgeContract.address, xagonZkEVMBridgeFactoryV2);
        const proxyAdmin = await upgrades.admin.getInstance();

        // Use timelock
        const operation = genOperation(
            proxyAdmin.address,
            0,
            proxyAdmin.interface.encodeFunctionData(
                'upgrade',
                [xagonZkEVMBridgeContract.address,
                    implBridgeV2Address],
            ),
            ethers.constants.HashZero,
            ethers.constants.HashZero,
        );

        // Check current delay
        expect(await timelockContract.getMinDelay()).to.be.equal(minDelay);

        // Put zkevmcontract on emergency mode
        await xagonZkEVMContract.activateEmergencyState(0);

        // Check delay is 0
        expect(await timelockContract.getMinDelay()).to.be.equal(0);

        // Schedule operation
        await timelockContract.schedule(
            operation.target,
            operation.value,
            operation.data,
            operation.predecessor,
            operation.salt,
            0,
        );

        // Check that is the v0 contract
        await expect(xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.reverted;

        // Transaction cna be executed, delay is reduced to 0, but fails bc this timelock is not owner
        await expect(timelockContract.execute(
            operation.target,
            operation.value,
            operation.data,
            operation.predecessor,
            operation.salt,
        )).to.be.revertedWith('TimelockController: underlying transaction reverted');
    });

    it('Should reprocude L2 enviromanet and check upgradability', async () => {
        const timelockContractFactory = await ethers.getContractFactory('XagonZkEVMTimelock');
        const proposers = [deployer.address];
        const executors = [deployer.address];
        const adminAddress = deployer.address;
        const timelockContractL2 = await timelockContractFactory.deploy(
            minDelay,
            proposers,
            executors,
            adminAddress,
            ethers.constants.AddressZero,
        );
        await timelockContractL2.deployed();

        // Check deploy parameters
        expect(await timelockContractL2.getMinDelay()).to.be.equal(minDelay);
        expect(await timelockContractL2.xagonZkEVM()).to.be.equal(ethers.constants.AddressZero);

        // Upgrade the contract
        const xagonZkEVMBridgeFactoryV2 = await ethers.getContractFactory('XagonZkEVMBridgeMock');
        const xagonZkEVMBridgeContractV2 = xagonZkEVMBridgeFactoryV2.attach(xagonZkEVMBridgeContract.address);

        // Check that is the v0 contract
        await expect(xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.reverted;

        // Transfer ownership to timelock

        // Can't upgrade the contract since it does not have the ownership
        await expect(upgrades.upgradeProxy(xagonZkEVMBridgeContract.address, xagonZkEVMBridgeFactoryV2))
            .to.be.reverted;

        const implBridgeV2Address = await upgrades.prepareUpgrade(xagonZkEVMBridgeContract.address, xagonZkEVMBridgeFactoryV2);
        const proxyAdmin = await upgrades.admin.getInstance();

        // Use timelock
        const operation = genOperation(
            proxyAdmin.address,
            0,
            proxyAdmin.interface.encodeFunctionData(
                'upgrade',
                [xagonZkEVMBridgeContract.address,
                    implBridgeV2Address],
            ),
            ethers.constants.HashZero,
            ethers.constants.HashZero,
        );

        // Check current delay
        expect(await timelockContractL2.getMinDelay()).to.be.equal(minDelay);

        /*
         * Put zkevmcontract on emergency mode
         * Does not affect thsi deployment
         */
        await xagonZkEVMContract.activateEmergencyState(0);

        // Check delay is 0
        expect(await timelockContractL2.getMinDelay()).to.be.equal(minDelay);

        // Schedule operation
        await expect(timelockContractL2.schedule(
            operation.target,
            operation.value,
            operation.data,
            operation.predecessor,
            operation.salt,
            0,
        )).to.be.revertedWith('TimelockController: insufficient delay');

        await timelockContractL2.schedule(
            operation.target,
            operation.value,
            operation.data,
            operation.predecessor,
            operation.salt,
            minDelay,
        );

        // Check that is the v0 contract
        await expect(xagonZkEVMBridgeContractV2.maxEtherBridge()).to.be.reverted;

        // Transaction cna be executed, delay is reduced to 0, but fails bc this timelock is not owner
        await expect(timelockContractL2.execute(
            operation.target,
            operation.value,
            operation.data,
            operation.predecessor,
            operation.salt,
        )).to.be.revertedWith('TimelockController: operation is not ready');
    });
});
