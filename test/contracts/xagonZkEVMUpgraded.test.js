/* eslint-disable no-plusplus, no-await-in-loop */
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('XagonZkEVMUpgraded', () => {
    let deployer;
    let trustedAggregator;
    let trustedSequencer;
    let admin;
    let aggregator1;

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
    const currentVersion = 0;

    // XagonZkEVM Constants
    const FORCE_BATCH_TIMEOUT = 60 * 60 * 24 * 5; // 5 days

    beforeEach('Deploy contract', async () => {
        upgrades.silenceWarnings();

        // load signers
        [deployer, trustedAggregator, trustedSequencer, admin, aggregator1] = await ethers.getSigners();

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
        const XagonZkEVMFactory = await ethers.getContractFactory('XagonZkEVMUpgraded');
        xagonZkEVMContract = await upgrades.deployProxy(XagonZkEVMFactory, [], {
            initializer: false,
            constructorArgs: [
                xagonZkEVMGlobalExitRoot.address,
                maticTokenContract.address,
                verifierContract.address,
                xagonZkEVMBridgeContract.address,
                chainID,
                forkID,
                currentVersion,
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

        const lastVerifiedBatch = 0;
        await expect(xagonZkEVMContract.updateVersion(newVersionString))
            .to.emit(xagonZkEVMContract, 'UpdateZkEVMVersion').withArgs(lastVerifiedBatch, forkID, newVersionString);

        expect(await xagonZkEVMContract.version()).to.be.equal(1);

        await expect(xagonZkEVMContract.updateVersion(newVersionString))
            .to.be.revertedWith('VersionAlreadyUpdated');
    });

    it('should upgrade xagonKEVM', async () => {
        // deploy XagonZkEVMTestnet
        const XagonZkEVMFactory = await ethers.getContractFactory('XagonZkEVM');
        const oldXagonZkEVMContract = await upgrades.deployProxy(XagonZkEVMFactory, [], {
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

        // initialize
        await oldXagonZkEVMContract.initialize(
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

        /*
         * Upgrade the contract
         */
        const XagonZkEVMUpgradedFactory = await ethers.getContractFactory('XagonZkEVMUpgraded');
        const xagonZkEVMUpgradedContract = XagonZkEVMUpgradedFactory.attach(oldXagonZkEVMContract.address);

        // Check that is the v0 contract
        await expect(xagonZkEVMUpgradedContract.version()).to.be.reverted;

        // Upgrade the contract
        const newVersionString = '0.0.2';

        await upgrades.upgradeProxy(
            xagonZkEVMContract.address,
            XagonZkEVMUpgradedFactory,
            {
                constructorArgs: [
                    xagonZkEVMGlobalExitRoot.address,
                    maticTokenContract.address,
                    verifierContract.address,
                    xagonZkEVMBridgeContract.address,
                    chainID,
                    forkID,
                    currentVersion],
                unsafeAllow: ['constructor', 'state-variable-immutable'],
                call: { fn: 'updateVersion', args: [newVersionString] },
            },
        );

        expect(await xagonZkEVMContract.version()).to.be.equal(1);
        await expect(xagonZkEVMContract.updateVersion(newVersionString))
            .to.be.revertedWith('VersionAlreadyUpdated');
    });

    it('should check the constructor parameters', async () => {
        expect(await xagonZkEVMContract.globalExitRootManager()).to.be.equal(xagonZkEVMGlobalExitRoot.address);
        expect(await xagonZkEVMContract.matic()).to.be.equal(maticTokenContract.address);
        expect(await xagonZkEVMContract.rollupVerifier()).to.be.equal(verifierContract.address);
        expect(await xagonZkEVMContract.bridgeAddress()).to.be.equal(xagonZkEVMBridgeContract.address);

        expect(await xagonZkEVMContract.owner()).to.be.equal(deployer.address);
        expect(await xagonZkEVMContract.admin()).to.be.equal(admin.address);
        expect(await xagonZkEVMContract.chainID()).to.be.equal(chainID);
        expect(await xagonZkEVMContract.trustedSequencer()).to.be.equal(trustedSequencer.address);
        expect(await xagonZkEVMContract.pendingStateTimeout()).to.be.equal(pendingStateTimeoutDefault);
        expect(await xagonZkEVMContract.trustedAggregator()).to.be.equal(trustedAggregator.address);
        expect(await xagonZkEVMContract.trustedAggregatorTimeout()).to.be.equal(trustedAggregatorTimeoutDefault);

        expect(await xagonZkEVMContract.batchNumToStateRoot(0)).to.be.equal(genesisRoot);
        expect(await xagonZkEVMContract.trustedSequencerURL()).to.be.equal(urlSequencer);
        expect(await xagonZkEVMContract.networkName()).to.be.equal(networkName);

        expect(await xagonZkEVMContract.batchFee()).to.be.equal(ethers.utils.parseEther('0.1'));
        expect(await xagonZkEVMContract.batchFee()).to.be.equal(ethers.utils.parseEther('0.1'));
        expect(await xagonZkEVMContract.getForcedBatchFee()).to.be.equal(ethers.utils.parseEther('10'));

        expect(await xagonZkEVMContract.forceBatchTimeout()).to.be.equal(FORCE_BATCH_TIMEOUT);
        expect(await xagonZkEVMContract.isForcedBatchDisallowed()).to.be.equal(true);
    });

    it('Test overridePendingState properly', async () => {
        const l2txData = '0x123456';
        const currentTimestamp = (await ethers.provider.getBlock()).timestamp;

        const batchesForSequence = 5;
        const sequence = {
            transactions: l2txData,
            globalExitRoot: ethers.constants.HashZero,
            timestamp: currentTimestamp,
            minForcedTimestamp: 0,
        };
        const sequencesArray = Array(batchesForSequence).fill(sequence);
        // Array(5).fill("girl", 0);

        // Approve lots of tokens
        await expect(
            maticTokenContract.connect(trustedSequencer).approve(xagonZkEVMContract.address, maticTokenInitialBalance),
        ).to.emit(maticTokenContract, 'Approval');

        // Make 20 sequences of 5 batches, with 1 minut timestamp difference
        for (let i = 0; i < 20; i++) {
            await expect(xagonZkEVMContract.connect(trustedSequencer).sequenceBatches(sequencesArray, trustedSequencer.address))
                .to.emit(xagonZkEVMContract, 'SequenceBatches');
        }
        await ethers.provider.send('evm_increaseTime', [60]);

        // Forge first sequence with verifyBAtches
        const newLocalExitRoot = '0x0000000000000000000000000000000000000000000000000000000000000001';
        const newStateRoot = '0x0000000000000000000000000000000000000000000000000000000000000002';
        const zkProofFFlonk = new Array(24).fill(ethers.constants.HashZero);

        let currentPendingState = 0;
        let currentNumBatch = 0;
        let newBatch = currentNumBatch + batchesForSequence;

        // Verify batch 2 batches
        await expect(
            xagonZkEVMContract.connect(aggregator1).verifyBatches(
                currentPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'VerifyBatches')
            .withArgs(newBatch, newStateRoot, aggregator1.address);

        // verify second sequence
        currentPendingState++;
        currentNumBatch = newBatch;
        newBatch += batchesForSequence;
        await expect(
            xagonZkEVMContract.connect(aggregator1).verifyBatches(
                currentPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'VerifyBatches')
            .withArgs(newBatch, newStateRoot, aggregator1.address);

        const finalPendingState = 2;

        await expect(
            xagonZkEVMContract.connect(aggregator1).overridePendingState(
                currentPendingState,
                finalPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('OnlyTrustedAggregator');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                finalPendingState + 1,
                finalPendingState + 2,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('PendingStateDoesNotExist');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                currentPendingState,
                finalPendingState,
                currentNumBatch + 1,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('InitNumBatchDoesNotMatchPendingState');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                currentPendingState,
                finalPendingState,
                currentNumBatch,
                newBatch + 1,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('FinalNumBatchDoesNotMatchPendingState');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                0,
                finalPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('OldStateRootDoesNotExist');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                finalPendingState,
                finalPendingState,
                currentNumBatch + 5,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('FinalPendingStateNumInvalid');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                finalPendingState,
                finalPendingState + 2,
                currentNumBatch + 5,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('FinalPendingStateNumInvalid');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                currentPendingState,
                finalPendingState,
                currentNumBatch,
                newBatch + 1,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('FinalNumBatchDoesNotMatchPendingState');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                currentPendingState,
                finalPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('StoredRootMustBeDifferentThanNewRoot');

        const newStateRoot2 = '0x0000000000000000000000000000000000000000000000000000000000000003';
        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                currentPendingState,
                finalPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot2,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'OverridePendingState').withArgs(newBatch, newStateRoot2, trustedAggregator.address);

        // check pending state is clear
        currentPendingState = 0;
        expect(currentPendingState).to.be.equal(await xagonZkEVMContract.lastPendingState());
        expect(0).to.be.equal(await xagonZkEVMContract.lastPendingStateConsolidated());

        // check consolidated state
        const currentVerifiedBatch = newBatch;
        expect(currentVerifiedBatch).to.be.equal(await xagonZkEVMContract.lastVerifiedBatch());
        expect(newStateRoot2).to.be.equal(await xagonZkEVMContract.batchNumToStateRoot(currentVerifiedBatch));
    });

    it('Test overridePendingState fails cause was last forkID', async () => {
        const l2txData = '0x123456';
        const currentTimestamp = (await ethers.provider.getBlock()).timestamp;

        const batchesForSequence = 5;
        const sequence = {
            transactions: l2txData,
            globalExitRoot: ethers.constants.HashZero,
            timestamp: currentTimestamp,
            minForcedTimestamp: 0,
        };
        const sequencesArray = Array(batchesForSequence).fill(sequence);
        // Array(5).fill("girl", 0);

        // Approve lots of tokens
        await expect(
            maticTokenContract.connect(trustedSequencer).approve(xagonZkEVMContract.address, maticTokenInitialBalance),
        ).to.emit(maticTokenContract, 'Approval');

        // Make 20 sequences of 5 batches, with 1 minut timestamp difference
        for (let i = 0; i < 20; i++) {
            await expect(xagonZkEVMContract.connect(trustedSequencer).sequenceBatches(sequencesArray, trustedSequencer.address))
                .to.emit(xagonZkEVMContract, 'SequenceBatches');
        }
        await ethers.provider.send('evm_increaseTime', [60]);

        // Forge first sequence with verifyBAtches
        const newLocalExitRoot = '0x0000000000000000000000000000000000000000000000000000000000000001';
        const newStateRoot = '0x0000000000000000000000000000000000000000000000000000000000000002';
        const zkProofFFlonk = new Array(24).fill(ethers.constants.HashZero);

        let currentPendingState = 0;
        let currentNumBatch = 0;
        let newBatch = currentNumBatch + batchesForSequence;

        // Verify batch 2 batches
        await expect(
            xagonZkEVMContract.connect(aggregator1).verifyBatches(
                currentPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'VerifyBatches')
            .withArgs(newBatch, newStateRoot, aggregator1.address);

        // verify second sequence
        currentPendingState++;
        currentNumBatch = newBatch;
        newBatch += batchesForSequence;
        await expect(
            xagonZkEVMContract.connect(aggregator1).verifyBatches(
                currentPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'VerifyBatches')
            .withArgs(newBatch, newStateRoot, aggregator1.address);

        const finalPendingState = 2;

        const consolidatedBatch = batchesForSequence;
        await expect(
            xagonZkEVMContract.connect(trustedAggregator).consolidatePendingState(
                1, // pending state num
            ),
        ).to.emit(xagonZkEVMContract, 'ConsolidatePendingState')
            .withArgs(consolidatedBatch, newStateRoot, 1);

        // Upgrade the contract
        const newVersionString = '0.0.3';
        await expect(xagonZkEVMContract.updateVersion(newVersionString))
            .to.emit(xagonZkEVMContract, 'UpdateZkEVMVersion').withArgs(consolidatedBatch, forkID, newVersionString);

        const newStateRoot2 = '0x0000000000000000000000000000000000000000000000000000000000000003';
        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                0,
                finalPendingState,
                0,
                newBatch,
                newLocalExitRoot,
                newStateRoot2,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('InitBatchMustMatchCurrentForkID');
    });

    it('Test overridePendingState fails cause was last forkID2', async () => {
        const l2txData = '0x123456';
        const currentTimestamp = (await ethers.provider.getBlock()).timestamp;

        const batchesForSequence = 5;
        const sequence = {
            transactions: l2txData,
            globalExitRoot: ethers.constants.HashZero,
            timestamp: currentTimestamp,
            minForcedTimestamp: 0,
        };
        const sequencesArray = Array(batchesForSequence).fill(sequence);
        // Array(5).fill("girl", 0);

        // Approve lots of tokens
        await expect(
            maticTokenContract.connect(trustedSequencer).approve(xagonZkEVMContract.address, maticTokenInitialBalance),
        ).to.emit(maticTokenContract, 'Approval');

        // Make 20 sequences of 5 batches, with 1 minut timestamp difference
        for (let i = 0; i < 20; i++) {
            await expect(xagonZkEVMContract.connect(trustedSequencer).sequenceBatches(sequencesArray, trustedSequencer.address))
                .to.emit(xagonZkEVMContract, 'SequenceBatches');
        }
        await ethers.provider.send('evm_increaseTime', [60]);

        // Forge first sequence with verifyBAtches
        const newLocalExitRoot = '0x0000000000000000000000000000000000000000000000000000000000000001';
        const newStateRoot = '0x0000000000000000000000000000000000000000000000000000000000000002';
        const zkProofFFlonk = new Array(24).fill(ethers.constants.HashZero);

        let currentPendingState = 0;
        let currentNumBatch = 0;
        let newBatch = currentNumBatch + batchesForSequence;

        // Verify batch 2 batches
        await expect(
            xagonZkEVMContract.connect(aggregator1).verifyBatches(
                currentPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'VerifyBatches')
            .withArgs(newBatch, newStateRoot, aggregator1.address);

        // verify second sequence
        currentPendingState++;
        currentNumBatch = newBatch;
        newBatch += batchesForSequence;
        await expect(
            xagonZkEVMContract.connect(aggregator1).verifyBatches(
                currentPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'VerifyBatches')
            .withArgs(newBatch, newStateRoot, aggregator1.address);

        const finalPendingState = 2;

        const consolidatedBatch = batchesForSequence;
        await expect(
            xagonZkEVMContract.connect(trustedAggregator).consolidatePendingState(
                1, // pending state num
            ),
        ).to.emit(xagonZkEVMContract, 'ConsolidatePendingState')
            .withArgs(consolidatedBatch, newStateRoot, 1);

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).consolidatePendingState(
                finalPendingState, // pending state num
            ),
        ).to.emit(xagonZkEVMContract, 'ConsolidatePendingState')
            .withArgs(newBatch, newStateRoot, finalPendingState);

        // Upgrade the contract
        const newVersionString = '0.0.3';
        const updatedBatch = newBatch;
        await expect(xagonZkEVMContract.updateVersion(newVersionString))
            .to.emit(xagonZkEVMContract, 'UpdateZkEVMVersion').withArgs(updatedBatch, forkID, newVersionString);

        // verify second sequence
        currentPendingState++;
        currentNumBatch = newBatch;
        newBatch += batchesForSequence;
        await expect(
            xagonZkEVMContract.connect(aggregator1).verifyBatches(
                currentPendingState,
                currentNumBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'VerifyBatches')
            .withArgs(newBatch, newStateRoot, aggregator1.address);

        const newStateRoot2 = '0x0000000000000000000000000000000000000000000000000000000000000003';
        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                0,
                currentPendingState,
                consolidatedBatch,
                newBatch,
                newLocalExitRoot,
                newStateRoot2,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('InitBatchMustMatchCurrentForkID');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).overridePendingState(
                0,
                currentPendingState,
                updatedBatch - 1,
                newBatch,
                newLocalExitRoot,
                newStateRoot2,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('InitBatchMustMatchCurrentForkID');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).verifyBatchesTrustedAggregator(
                0,
                updatedBatch - 1,
                newBatch,
                newLocalExitRoot,
                newStateRoot2,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('InitBatchMustMatchCurrentForkID');
    });
});
