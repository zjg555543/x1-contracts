// SPDX-License-Identifier: AGPL-3.0

pragma solidity 0.8.20;

interface IDataCommittee {
    function verifySignatures(bytes32 hash, bytes memory signaturesAndAddrs) external view;
}