// SPDX-License-Identifier: AGPL-3.0

pragma solidity 0.8.20;

/**
 * @dev Define interface for XagonZkEVM Bridge message receiver
 */
interface IBridgeMessageReceiver {
    function onMessageReceived(
        address originAddress,
        uint32 originNetwork,
        bytes memory data
    ) external payable;
}
