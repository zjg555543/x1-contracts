const { expect } = require('chai');
const { ethers } = require('hardhat');

const zero32bytes = '0x0000000000000000000000000000000000000000000000000000000000000000';

describe('Global Exit Root L2', () => {
    let XagonZkEVMBridge;
    let xagonZkEVMGlobalExitRoot;
    let deployer;

    beforeEach('Deploy contracts', async () => {
        // load signers
        [deployer, XagonZkEVMBridge] = await ethers.getSigners();

        // deploy global exit root manager
        const XagonZkEVMGlobalExitRootFactory = await ethers.getContractFactory('XagonZkEVMGlobalExitRootL2Mock', deployer);
        xagonZkEVMGlobalExitRoot = await XagonZkEVMGlobalExitRootFactory.deploy(XagonZkEVMBridge.address);
    });

    it('should check the constructor parameters', async () => {
        expect(await xagonZkEVMGlobalExitRoot.bridgeAddress()).to.be.equal(XagonZkEVMBridge.address);
        expect(await xagonZkEVMGlobalExitRoot.lastRollupExitRoot()).to.be.equal(zero32bytes);
    });

    it('should update root and check global exit root', async () => {
        const newRootRollup = ethers.utils.hexlify(ethers.utils.randomBytes(32));

        await expect(xagonZkEVMGlobalExitRoot.updateExitRoot(newRootRollup))
            .to.be.revertedWith('OnlyAllowedContracts');

        // Update root from the rollup
        await xagonZkEVMGlobalExitRoot.connect(XagonZkEVMBridge).updateExitRoot(newRootRollup);

        expect(await xagonZkEVMGlobalExitRoot.lastRollupExitRoot()).to.be.equal(newRootRollup);
    });

    it('should update root and check the storage position matches', async () => {
        // Check global exit root
        const newRoot = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        const blockNumber = 1;
        await xagonZkEVMGlobalExitRoot.setLastGlobalExitRoot(newRoot, blockNumber);
        expect(await xagonZkEVMGlobalExitRoot.globalExitRootMap(newRoot)).to.be.equal(blockNumber);
        const mapStoragePosition = 0;
        const key = newRoot;
        const storagePosition = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [key, mapStoragePosition]);
        const storageValue = await ethers.provider.getStorageAt(xagonZkEVMGlobalExitRoot.address, storagePosition);
        expect(blockNumber).to.be.equal(ethers.BigNumber.from(storageValue).toNumber());

        // Check rollup exit root
        const newRootRollupExitRoot = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        await xagonZkEVMGlobalExitRoot.setExitRoot(newRootRollupExitRoot);
        expect(await xagonZkEVMGlobalExitRoot.lastRollupExitRoot()).to.be.equal(newRootRollupExitRoot);

        const storagePositionExitRoot = 1;
        const storageValueExitRoot = await ethers.provider.getStorageAt(xagonZkEVMGlobalExitRoot.address, storagePositionExitRoot);
        expect(newRootRollupExitRoot, storageValueExitRoot);
    });
});
