// SPDX-License-Identifier: AGPL-3.0

pragma solidity ^0.8.20;
import "./IBaseXagonZkEVMGlobalExitRoot.sol";

interface IXagonZkEVMGlobalExitRoot is IBaseXagonZkEVMGlobalExitRoot {
    function getLastGlobalExitRoot() external view returns (bytes32);
}
