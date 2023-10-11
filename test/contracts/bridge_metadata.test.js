const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const MerkleTreeBridge = require('@okx/zkevm-commonjs').MTBridge;
const {
    getLeafValue,
} = require('@okx/zkevm-commonjs').mtBridgeUtils;

describe('XagonZkEVMBridge Contract werid metadata', () => {
    let deployer;
    let rollup;

    let xagonZkEVMGlobalExitRoot;
    let xagonZkEVMBridgeContract;
    let tokenContract;

    const tokenName = 'Matic Token';
    const tokenSymbol = 'MATIC';
    const decimals = 18;
    const tokenInitialBalance = ethers.utils.parseEther('20000000');

    const networkIDMainnet = 0;
    const networkIDRollup = 1;
    const LEAF_TYPE_ASSET = 0;

    const xagonZkEVMAddress = ethers.constants.AddressZero;

    beforeEach('Deploy contracts', async () => {
        // load signers
        [deployer, rollup] = await ethers.getSigners();

        // deploy XagonZkEVMBridge
        const xagonZkEVMBridgeFactory = await ethers.getContractFactory('XagonZkEVMBridge');
        xagonZkEVMBridgeContract = await upgrades.deployProxy(xagonZkEVMBridgeFactory, [], { initializer: false });

        // deploy global exit root manager
        const xagonZkEVMGlobalExitRootFactory = await ethers.getContractFactory('XagonZkEVMGlobalExitRoot');
        xagonZkEVMGlobalExitRoot = await xagonZkEVMGlobalExitRootFactory.deploy(rollup.address, xagonZkEVMBridgeContract.address);

        await xagonZkEVMBridgeContract.initialize(networkIDMainnet, xagonZkEVMGlobalExitRoot.address, xagonZkEVMAddress);

        // deploy token
        const maticTokenFactory = await ethers.getContractFactory('TokenWrapped');
        tokenContract = await maticTokenFactory.deploy(
            tokenName,
            tokenSymbol,
            decimals,
        );
        await tokenContract.deployed();

        await tokenContract.mint(deployer.address, tokenInitialBalance);
    });

    it('should XagonZkEVMBridge with weird token metadata', async () => {
        const weirdErc20Metadata = await ethers.getContractFactory('ERC20WeirdMetadata');

        const nameWeird = 'nameToken';
        const symbolWeird = 'NTK';

        const nameWeirdBytes32 = ethers.utils.formatBytes32String(nameWeird);
        const symbolWeirdBytes = ethers.utils.toUtf8Bytes(symbolWeird);
        const decimalsWeird = 14;

        const weirdTokenContract = await weirdErc20Metadata.deploy(
            nameWeirdBytes32, // bytes32
            symbolWeirdBytes, // bytes
            decimalsWeird,
        );
        await weirdTokenContract.deployed();

        // mint and approve tokens
        await weirdTokenContract.mint(deployer.address, tokenInitialBalance);
        await weirdTokenContract.approve(xagonZkEVMBridgeContract.address, tokenInitialBalance);

        const depositCount = await xagonZkEVMBridgeContract.depositCount();
        const originNetwork = networkIDMainnet;
        const tokenAddress = weirdTokenContract.address;
        const amount = ethers.utils.parseEther('10');
        const destinationNetwork = networkIDRollup;
        const destinationAddress = deployer.address;

        const metadata = ethers.utils.defaultAbiCoder.encode(
            ['string', 'string', 'uint8'],
            [nameWeird, symbolWeird, decimalsWeird],
        );

        const metadataHash = ethers.utils.solidityKeccak256(['bytes'], [metadata]);

        // pre compute root merkle tree in Js
        const height = 32;
        const merkleTree = new MerkleTreeBridge(height);
        const leafValue = getLeafValue(
            LEAF_TYPE_ASSET,
            originNetwork,
            tokenAddress,
            destinationNetwork,
            destinationAddress,
            amount,
            metadataHash,
        );
        merkleTree.add(leafValue);
        const rootJSMainnet = merkleTree.getRoot();

        await expect(xagonZkEVMBridgeContract.bridgeAsset(destinationNetwork, destinationAddress, amount, tokenAddress, true, '0x'))
            .to.emit(xagonZkEVMBridgeContract, 'BridgeEvent')
            .withArgs(LEAF_TYPE_ASSET, originNetwork, tokenAddress, destinationNetwork, destinationAddress, amount, metadata, depositCount);

        expect(await xagonZkEVMBridgeContract.getDepositRoot()).to.be.equal(rootJSMainnet);
    });

    it('should XagonZkEVMBridge with weird token metadata with reverts', async () => {
        const weirdErc20Metadata = await ethers.getContractFactory('ERC20WeirdMetadata');

        const nameWeird = 'nameToken';
        const symbolWeird = 'NTK';

        const nameWeirdBytes32 = ethers.utils.formatBytes32String(nameWeird);
        const symbolWeirdBytes = ethers.utils.toUtf8Bytes(symbolWeird);
        const decimalsWeird = ethers.constants.MaxUint256;

        const weirdTokenContract = await weirdErc20Metadata.deploy(
            nameWeirdBytes32, // bytes32
            symbolWeirdBytes, // bytes
            decimalsWeird,
        );
        await weirdTokenContract.deployed();

        // mint and approve tokens
        await weirdTokenContract.mint(deployer.address, tokenInitialBalance);
        await weirdTokenContract.approve(xagonZkEVMBridgeContract.address, tokenInitialBalance);

        const depositCount = await xagonZkEVMBridgeContract.depositCount();
        const originNetwork = networkIDMainnet;
        const tokenAddress = weirdTokenContract.address;
        const amount = ethers.utils.parseEther('10');
        const destinationNetwork = networkIDRollup;
        const destinationAddress = deployer.address;

        // Since cannot decode decimals
        await expect(xagonZkEVMBridgeContract.bridgeAsset(destinationNetwork, destinationAddress, amount, tokenAddress, true, '0x')).to.be.reverted;

        // toogle revert
        await weirdTokenContract.toggleIsRevert();
        // Use revert strings
        const nameRevert = 'NO_NAME';
        const symbolRevert = 'NO_SYMBOL';
        const decimalsTooRevert = 18;
        const metadata = ethers.utils.defaultAbiCoder.encode(
            ['string', 'string', 'uint8'],
            [nameRevert, symbolRevert, decimalsTooRevert],
        );

        const metadataHash = ethers.utils.solidityKeccak256(['bytes'], [metadata]);

        // pre compute root merkle tree in Js
        const height = 32;
        const merkleTree = new MerkleTreeBridge(height);
        const leafValue = getLeafValue(
            LEAF_TYPE_ASSET,
            originNetwork,
            tokenAddress,
            destinationNetwork,
            destinationAddress,
            amount,
            metadataHash,
        );
        merkleTree.add(leafValue);
        const rootJSMainnet = merkleTree.getRoot();

        await expect(xagonZkEVMBridgeContract.bridgeAsset(destinationNetwork, destinationAddress, amount, tokenAddress, true, '0x'))
            .to.emit(xagonZkEVMBridgeContract, 'BridgeEvent')
            .withArgs(LEAF_TYPE_ASSET, originNetwork, tokenAddress, destinationNetwork, destinationAddress, amount, metadata, depositCount);

        expect(await xagonZkEVMBridgeContract.getDepositRoot()).to.be.equal(rootJSMainnet);
    });

    it('should XagonZkEVMBridge with weird token metadata with empty data', async () => {
        const weirdErc20Metadata = await ethers.getContractFactory('ERC20WeirdMetadata');

        const nameWeird = '';
        const symbolWeird = '';

        const nameWeirdBytes32 = ethers.utils.formatBytes32String(nameWeird);
        const symbolWeirdBytes = ethers.utils.toUtf8Bytes(symbolWeird);
        const decimalsWeird = 255;

        const weirdTokenContract = await weirdErc20Metadata.deploy(
            nameWeirdBytes32, // bytes32
            symbolWeirdBytes, // bytes
            decimalsWeird,
        );
        await weirdTokenContract.deployed();

        // mint and approve tokens
        await weirdTokenContract.mint(deployer.address, tokenInitialBalance);
        await weirdTokenContract.approve(xagonZkEVMBridgeContract.address, tokenInitialBalance);

        const depositCount = await xagonZkEVMBridgeContract.depositCount();
        const originNetwork = networkIDMainnet;
        const tokenAddress = weirdTokenContract.address;
        const amount = ethers.utils.parseEther('10');
        const destinationNetwork = networkIDRollup;
        const destinationAddress = deployer.address;

        // Empty bytes32 is a not valid encoding
        const nameEmpty = 'NOT_VALID_ENCODING'; // bytes32 empty
        const symbolEmpty = '';

        const metadata = ethers.utils.defaultAbiCoder.encode(
            ['string', 'string', 'uint8'],
            [nameEmpty, symbolEmpty, decimalsWeird],
        );

        const metadataHash = ethers.utils.solidityKeccak256(['bytes'], [metadata]);

        // pre compute root merkle tree in Js
        const height = 32;
        const merkleTree = new MerkleTreeBridge(height);
        const leafValue = getLeafValue(
            LEAF_TYPE_ASSET,
            originNetwork,
            tokenAddress,
            destinationNetwork,
            destinationAddress,
            amount,
            metadataHash,
        );
        merkleTree.add(leafValue);
        const rootJSMainnet = merkleTree.getRoot();

        await expect(xagonZkEVMBridgeContract.bridgeAsset(destinationNetwork, destinationAddress, amount, tokenAddress, true, '0x'))
            .to.emit(xagonZkEVMBridgeContract, 'BridgeEvent')
            .withArgs(LEAF_TYPE_ASSET, originNetwork, tokenAddress, destinationNetwork, destinationAddress, amount, metadata, depositCount);

        expect(await xagonZkEVMBridgeContract.getDepositRoot()).to.be.equal(rootJSMainnet);
    });
});
