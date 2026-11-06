// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract DaoVoteVerifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 17744269459934839149787860145919436978472761157705413873052751471180938875809;
    uint256 constant alphay  = 17641136786394411154034930329632377560286078506278676665130290291360453737536;
    uint256 constant betax1  = 807230497673958962140554990442398656860204513095204117599060193767305871026;
    uint256 constant betax2  = 12614512961284414106301045398313538812651296375071353349508136171727162201112;
    uint256 constant betay1  = 2837457954327557141721463526858675290566890468955102632721827751688749173771;
    uint256 constant betay2  = 15893491668231757638591984021736122393034032415063309661555008247936517455368;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 20199280078047178650929303537381479402384222624938646396771103748526909222284;
    uint256 constant deltax2 = 13342770704195179746445999259457762120237450951289631626101267783828022573353;
    uint256 constant deltay1 = 10863701171646402487310644807575540528553755437680542527559860448996962657684;
    uint256 constant deltay2 = 11093065341124261442724417282135086321412849794898729437773271923687272530897;

    
    uint256 constant IC0x = 16210532693155354431738697029056691664657854787414031983732487453884294090631;
    uint256 constant IC0y = 9838527126853337281232286418674707589057684452206409566834348344806031190995;
    
    uint256 constant IC1x = 16082304110158308706131717237676093005862671887097560936339438396313537896682;
    uint256 constant IC1y = 13480978005117166348845245072964526752666968878345987878476786428033841690898;
    
    uint256 constant IC2x = 1692528002849843593106895536645066689462198191591200888251527004809397350531;
    uint256 constant IC2y = 5431760504723525665348471812902311546320293114107393427470773635997312727866;
    
    uint256 constant IC3x = 3092391265331775011969866408605984091964249028903909636531952767703265530258;
    uint256 constant IC3y = 2028265879650471779075636386368407840212783249226294063436124224229811612;
    
    uint256 constant IC4x = 10235442666297456607942048483668377510550201194762514093657913413758907152041;
    uint256 constant IC4y = 6227703206276937448580005904153365532823471908767220280962255232407818576032;
    
    uint256 constant IC5x = 4139233173865432441595610668179552724348390017805293792226732503621311178407;
    uint256 constant IC5y = 16493788776407282491506572354890431946542426794893360847207711010687614823543;
    
    uint256 constant IC6x = 18066965199828376820592749428539769087722690521480168992017200863759626955523;
    uint256 constant IC6y = 183690754456503674053794874773679266538343407109508893574682887217965683428;
    
    uint256 constant IC7x = 18215200702214497908987334264771319134458427137234393192652916342424014245077;
    uint256 constant IC7y = 20675767066949089428582025912607287669823164883323916034345783998272609490068;
    
    uint256 constant IC8x = 16458614747538733676663434431669087442029953102106519580101426427662038750235;
    uint256 constant IC8y = 2696732025940290384687376231154489765440405276316290374388019975903644890837;
    
    uint256 constant IC9x = 4465846669523449220543390352811103614674504365002671310614110533488008725610;
    uint256 constant IC9y = 12752280177795639594932450255963553030350436847423569518434279459380307384145;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[9] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(30000, 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(30000, 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(200000, 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
