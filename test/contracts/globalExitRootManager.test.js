const { expect } = require('chai');
const { ethers } = require('hardhat');

function calculateGlobalExitRoot(mainnetExitRoot, rollupExitRoot) {
    return ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [mainnetExitRoot, rollupExitRoot]);
}
const zero32bytes = '0x0000000000000000000000000000000000000000000000000000000000000000';

describe('Global Exit Root', () => {
    let rollup;
    let XagonZkEVMBridge;

    let xagonZkEVMGlobalExitRoot;
    beforeEach('Deploy contracts', async () => {
        // load signers
        [, rollup, XagonZkEVMBridge] = await ethers.getSigners();

        // deploy global exit root manager
        const XagonZkEVMGlobalExitRootFactory = await ethers.getContractFactory('XagonZkEVMGlobalExitRoot');

        xagonZkEVMGlobalExitRoot = await XagonZkEVMGlobalExitRootFactory.deploy(
            rollup.address,
            XagonZkEVMBridge.address,
        );
        await xagonZkEVMGlobalExitRoot.deployed();
    });

    it('should check the constructor parameters', async () => {
        expect(await xagonZkEVMGlobalExitRoot.rollupAddress()).to.be.equal(rollup.address);
        expect(await xagonZkEVMGlobalExitRoot.bridgeAddress()).to.be.equal(XagonZkEVMBridge.address);
        expect(await xagonZkEVMGlobalExitRoot.lastRollupExitRoot()).to.be.equal(zero32bytes);
        expect(await xagonZkEVMGlobalExitRoot.lastMainnetExitRoot()).to.be.equal(zero32bytes);
    });

    it('should update root and check global exit root', async () => {
        const newRootRollup = ethers.utils.hexlify(ethers.utils.randomBytes(32));

        await expect(xagonZkEVMGlobalExitRoot.updateExitRoot(newRootRollup))
            .to.be.revertedWith('OnlyAllowedContracts');

        // Update root from the rollup
        await expect(xagonZkEVMGlobalExitRoot.connect(rollup).updateExitRoot(newRootRollup))
            .to.emit(xagonZkEVMGlobalExitRoot, 'UpdateGlobalExitRoot')
            .withArgs(zero32bytes, newRootRollup);

        expect(await xagonZkEVMGlobalExitRoot.getLastGlobalExitRoot())
            .to.be.equal(calculateGlobalExitRoot(zero32bytes, newRootRollup));

        // Update root from the XagonZkEVMBridge
        const newRootBridge = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        await expect(xagonZkEVMGlobalExitRoot.connect(XagonZkEVMBridge).updateExitRoot(newRootBridge))
            .to.emit(xagonZkEVMGlobalExitRoot, 'UpdateGlobalExitRoot')
            .withArgs(newRootBridge, newRootRollup);

        expect(await xagonZkEVMGlobalExitRoot.lastMainnetExitRoot()).to.be.equal(newRootBridge);
        expect(await xagonZkEVMGlobalExitRoot.getLastGlobalExitRoot())
            .to.be.equal(calculateGlobalExitRoot(newRootBridge, newRootRollup));
    });
});
