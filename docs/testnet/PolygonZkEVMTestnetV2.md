Contract responsible for managing the state and the updates of the L2 network
This contract will NOT BE USED IN PRODUCTION, will be used only in testnet enviroment


## Functions
### constructor
```solidity
  function constructor(
    contract IXagonZkEVMGlobalExitRoot _globalExitRootManager,
    contract IERC20Upgradeable _matic,
    contract IVerifierRollup _rollupVerifier,
    contract IXagonZkEVMBridge _bridgeAddress,
    uint64 _chainID
  ) public
```


#### Parameters:
| Name | Type | Description                                                          |
| :--- | :--- | :------------------------------------------------------------------- |
|`_globalExitRootManager` | contract IXagonZkEVMGlobalExitRoot | Global exit root manager address
|`_matic` | contract IERC20Upgradeable | MATIC token address
|`_rollupVerifier` | contract IVerifierRollup | Rollup verifier address
|`_bridgeAddress` | contract IXagonZkEVMBridge | Bridge address
|`_chainID` | uint64 | L2 chainID

### updateVersion
```solidity
  function updateVersion(
    string _versionString
  ) public
```
Update version of the zkEVM


#### Parameters:
| Name | Type | Description                                                          |
| :--- | :--- | :------------------------------------------------------------------- |
|`_versionString` | string | New version string

