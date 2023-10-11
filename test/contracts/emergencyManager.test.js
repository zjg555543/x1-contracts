const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('Emergency mode test', () => {
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
    const pendingStateTimeoutDefault = 10;
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

        // Activate force batches
        await expect(
            xagonZkEVMContract.connect(admin).activateForceBatches(),
        ).to.emit(xagonZkEVMContract, 'ActivateForceBatches');
    });

    it('should activate emergency mode', async () => {
        // Check isEmergencyState
        expect(await xagonZkEVMContract.isEmergencyState()).to.be.equal(false);
        expect(await xagonZkEVMBridgeContract.isEmergencyState()).to.be.equal(false);

        await expect(xagonZkEVMContract.connect(admin).deactivateEmergencyState())
            .to.be.revertedWith('OnlyEmergencyState');

        // Set isEmergencyState
        await expect(xagonZkEVMContract.connect(admin).activateEmergencyState(1))
            .to.be.revertedWith('BatchNotSequencedOrNotSequenceEnd');

        await expect(xagonZkEVMBridgeContract.connect(deployer).activateEmergencyState())
            .to.be.revertedWith('OnlyXagonZkEVM');

        await expect(xagonZkEVMContract.activateEmergencyState(0))
            .to.emit(xagonZkEVMContract, 'EmergencyStateActivated')
            .to.emit(xagonZkEVMBridgeContract, 'EmergencyStateActivated');

        expect(await xagonZkEVMContract.isEmergencyState()).to.be.equal(true);
        expect(await xagonZkEVMBridgeContract.isEmergencyState()).to.be.equal(true);

        // Once in emergency state no sequenceBatches/forceBatches can be done
        const l2txData = '0x123456';
        const maticAmount = await xagonZkEVMContract.batchFee();
        const currentTimestamp = (await ethers.provider.getBlock()).timestamp;

        const sequence = {
            transactions: l2txData,
            globalExitRoot: ethers.constants.HashZero,
            timestamp: ethers.BigNumber.from(currentTimestamp),
            minForcedTimestamp: 0,
        };

        // revert because emergency state
        await expect(xagonZkEVMContract.sequenceBatches([sequence], deployer.address))
            .to.be.revertedWith('OnlyNotEmergencyState');

        // revert because emergency state
        await expect(xagonZkEVMContract.sequenceForceBatches([sequence]))
            .to.be.revertedWith('OnlyNotEmergencyState');

        // revert because emergency state
        await expect(xagonZkEVMContract.forceBatch(l2txData, maticAmount))
            .to.be.revertedWith('OnlyNotEmergencyState');

        // revert because emergency state
        await expect(xagonZkEVMContract.consolidatePendingState(0))
            .to.be.revertedWith('OnlyNotEmergencyState');

        // trustedAggregator forge the batch
        const newLocalExitRoot = '0x0000000000000000000000000000000000000000000000000000000000000001';
        const newStateRoot = '0x0000000000000000000000000000000000000000000000000000000000000001';
        const numBatch = (await xagonZkEVMContract.lastVerifiedBatch()).toNumber() + 1;
        const zkProofFFlonk = new Array(24).fill(ethers.constants.HashZero);
        const pendingStateNum = 0;

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).verifyBatches(
                pendingStateNum,
                numBatch - 1,
                numBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('OnlyNotEmergencyState');

        // Check XagonZkEVMBridge no XagonZkEVMBridge is in emergency state also
        const tokenAddress = ethers.constants.AddressZero;
        const amount = ethers.utils.parseEther('10');
        const destinationNetwork = 1;
        const destinationAddress = deployer.address;

        await expect(xagonZkEVMBridgeContract.bridgeAsset(
            destinationNetwork,
            destinationAddress,
            amount,
            tokenAddress,
            true,
            '0x',
        )).to.be.revertedWith('OnlyNotEmergencyState');

        await expect(xagonZkEVMBridgeContract.bridgeMessage(
            destinationNetwork,
            destinationAddress,
            true,
            '0x',
        )).to.be.revertedWith('OnlyNotEmergencyState');

        const proof = Array(32).fill(ethers.constants.HashZero);
        const index = 0;
        const root = ethers.constants.HashZero;

        await expect(xagonZkEVMBridgeContract.claimAsset(
            proof,
            index,
            root,
            root,
            0,
            tokenAddress,
            destinationNetwork,
            destinationAddress,
            amount,
            '0x',
        )).to.be.revertedWith('OnlyNotEmergencyState');

        await expect(xagonZkEVMBridgeContract.claimMessage(
            proof,
            index,
            root,
            root,
            0,
            tokenAddress,
            destinationNetwork,
            destinationAddress,
            amount,
            '0x',
        )).to.be.revertedWith('OnlyNotEmergencyState');

        // Emergency council should deactivate emergency mode
        await expect(xagonZkEVMContract.activateEmergencyState(0))
            .to.be.revertedWith('OnlyNotEmergencyState');

        await expect(xagonZkEVMBridgeContract.connect(deployer).deactivateEmergencyState())
            .to.be.revertedWith('OnlyXagonZkEVM');

        await expect(xagonZkEVMContract.deactivateEmergencyState())
            .to.be.revertedWith('OnlyAdmin');

        await expect(xagonZkEVMContract.connect(admin).deactivateEmergencyState())
            .to.emit(xagonZkEVMContract, 'EmergencyStateDeactivated')
            .to.emit(xagonZkEVMBridgeContract, 'EmergencyStateDeactivated');

        // Check isEmergencyState
        expect(await xagonZkEVMContract.isEmergencyState()).to.be.equal(false);
        expect(await xagonZkEVMBridgeContract.isEmergencyState()).to.be.equal(false);

        /*
         * Continue normal flow
         * Approve tokens
         */
        await expect(
            maticTokenContract.connect(trustedSequencer).approve(xagonZkEVMContract.address, maticAmount),
        ).to.emit(maticTokenContract, 'Approval');

        const lastBatchSequenced = await xagonZkEVMContract.lastBatchSequenced();
        // Sequence Batches
        await expect(xagonZkEVMContract.connect(trustedSequencer).sequenceBatches([sequence], trustedSequencer.address))
            .to.emit(xagonZkEVMContract, 'SequenceBatches')
            .withArgs(lastBatchSequenced + 1);

        // trustedAggregator forge the batch
        const initialAggregatorMatic = await maticTokenContract.balanceOf(
            trustedAggregator.address,
        );
        await ethers.provider.send('evm_increaseTime', [trustedAggregatorTimeoutDefault]); // evm_setNextBlockTimestamp

        // Verify batch
        await expect(
            xagonZkEVMContract.connect(trustedAggregator).verifyBatches(
                pendingStateNum,
                numBatch - 1,
                numBatch,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'VerifyBatches')
            .withArgs(numBatch, newStateRoot, trustedAggregator.address);

        const finalAggregatorMatic = await maticTokenContract.balanceOf(
            trustedAggregator.address,
        );
        expect(finalAggregatorMatic).to.equal(
            ethers.BigNumber.from(initialAggregatorMatic).add(ethers.BigNumber.from(maticAmount)),
        );

        // Finally enter in emergency mode again proving distinc state
        const finalPendingStateNum = 1;

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).proveNonDeterministicPendingState(
                pendingStateNum,
                finalPendingStateNum,
                numBatch - 1,
                numBatch - 1,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('FinalNumBatchDoesNotMatchPendingState');

        await expect(
            xagonZkEVMContract.connect(trustedAggregator).proveNonDeterministicPendingState(
                pendingStateNum,
                finalPendingStateNum,
                numBatch - 1,
                numBatch + 1,
                newLocalExitRoot,
                newStateRoot,
                zkProofFFlonk,
            ),
        ).to.be.revertedWith('FinalNumBatchDoesNotMatchPendingState');

        const newStateRootDistinct = '0x0000000000000000000000000000000000000000000000000000000000000002';

        await expect(
            xagonZkEVMContract.proveNonDeterministicPendingState(
                pendingStateNum,
                finalPendingStateNum,
                numBatch - 1,
                numBatch,
                newLocalExitRoot,
                newStateRootDistinct,
                zkProofFFlonk,
            ),
        ).to.emit(xagonZkEVMContract, 'ProveNonDeterministicPendingState').withArgs(newStateRoot, newStateRootDistinct)
            .to.emit(xagonZkEVMContract, 'EmergencyStateActivated')
            .to.emit(xagonZkEVMBridgeContract, 'EmergencyStateActivated');

        // Check emergency state is active
        expect(await xagonZkEVMContract.isEmergencyState()).to.be.equal(true);
        expect(await xagonZkEVMBridgeContract.isEmergencyState()).to.be.equal(true);
    });
});
