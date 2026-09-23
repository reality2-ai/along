/* @ts-self-types="./hive_wasm.d.ts" */

/**
 * Owns core ordering and the candidate's newly generated member key.
 * No method accepts an arbitrary candidate public identity.
 */
export class BrowserCandidateCeremony {
    static __wrap(ptr) {
        const obj = Object.create(BrowserCandidateCeremony.prototype);
        obj.__wbg_ptr = ptr;
        BrowserCandidateCeremonyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BrowserCandidateCeremonyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_browsercandidateceremony_free(ptr, 0);
    }
    /**
     * Record the actual commitment before the provisioner reveals.
     * @param {Uint8Array} commitment
     */
    candidate_commits(commitment) {
        const ptr0 = passArray8ToWasm0(commitment, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.browsercandidateceremony_candidate_commits(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * End volatile custody. The enclosing session also voids its durable journal.
     */
    close() {
        wasm.browsercandidateceremony_close(this.__wbg_ptr);
    }
    /**
     * The enclosing comparison session must establish both people's decisions.
     * A boolean is not evidence of co-presence or of the displayed comparison.
     * @param {boolean} matched
     */
    confirm(matched) {
        const ret = wasm.browsercandidateceremony_confirm(this.__wbg_ptr, matched);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Consume verified invitation evidence. The caller must supply actual
     * platform claim/build state and the provisioner's custody/epoch facts.
     * This ordinary-member adapter cannot grant the key-holder role.
     * @param {BrowserInvitation} invitation
     * @param {string} candidate_state
     * @param {boolean} candidate_development
     * @param {boolean} provisioner_development
     * @param {boolean} provisioner_holds_custody
     * @param {bigint} provisioner_epoch
     * @returns {BrowserCandidateCeremony}
     */
    static discover(invitation, candidate_state, candidate_development, provisioner_development, provisioner_holds_custody, provisioner_epoch) {
        _assertClass(invitation, BrowserInvitation);
        var ptr0 = invitation.__destroy_into_raw();
        const ptr1 = passStringToWasm0(candidate_state, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.browsercandidateceremony_discover(ptr0, ptr1, len1, candidate_development, provisioner_development, provisioner_holds_custody, provisioner_epoch);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BrowserCandidateCeremony.__wrap(ret[0]);
    }
    /**
     * Record contributions only after the exchange has verified the commitment
     * and completed nondegenerate shared-secret derivation. The core orders the
     * steps; it does not perform that cryptographic verification on these bytes.
     * @param {Uint8Array} provisioner
     * @param {Uint8Array} candidate
     */
    exchanged(provisioner, candidate) {
        const ptr0 = passArray8ToWasm0(provisioner, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(candidate, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.browsercandidateceremony_exchanged(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Core certificate validation and the second OPEN check, synchronously.
     * The returned persona is PREPARED ONLY. Storage must atomically compare
     * current claim state, persist custody/persona and consume the invitation.
     * Do not announce enrollment or grant application access from this result.
     * @param {Uint8Array} certificate
     * @param {string} candidate_state_now
     * @returns {BrowserPreparedPersona}
     */
    prepare_install(certificate, candidate_state_now) {
        const ptr0 = passArray8ToWasm0(certificate, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(candidate_state_now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.browsercandidateceremony_prepare_install(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BrowserPreparedPersona.__wrap(ret[0]);
    }
    /**
     * Consume this candidate's generated key and run the first OPEN check.
     * A refused request drops custody; a successful one retains it here.
     * @param {BrowserCandidateKey} candidate
     * @param {string} candidate_state_now
     * @returns {Uint8Array}
     */
    request(candidate, candidate_state_now) {
        _assertClass(candidate, BrowserCandidateKey);
        var ptr0 = candidate.__destroy_into_raw();
        const ptr1 = passStringToWasm0(candidate_state_now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.browsercandidateceremony_request(this.__wbg_ptr, ptr0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
}
if (Symbol.dispose) BrowserCandidateCeremony.prototype[Symbol.dispose] = BrowserCandidateCeremony.prototype.free;

export class BrowserCandidateKey {
    static __wrap(ptr) {
        const obj = Object.create(BrowserCandidateKey.prototype);
        obj.__wbg_ptr = ptr;
        BrowserCandidateKeyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BrowserCandidateKeyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_browsercandidatekey_free(ptr, 0);
    }
    /**
     * Drop this handle's volatile custody. Does not promise engine memory erasure.
     */
    close() {
        wasm.browsercandidatekey_close(this.__wbg_ptr);
    }
    /**
     * Generate a fresh nonextractable Ed25519 private key on this candidate.
     * Unsupported browsers reject; no imported-key or software-seed fallback.
     * @returns {Promise<BrowserCandidateKey>}
     */
    static generate() {
        const ret = wasm.browsercandidatekey_generate();
        return ret;
    }
    /**
     * Public candidate identity. A closed handle cannot be reused in a claim.
     * @returns {Uint8Array}
     */
    public_key() {
        const ret = wasm.browsercandidatekey_public_key(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Sign canonical protocol bytes; the enclosing runtime owns authorization.
     * Closing during crypto prevents its late result from reaching the caller.
     * @param {Uint8Array} message
     * @returns {Promise<Uint8Array>}
     */
    sign(message) {
        const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.browsercandidatekey_sign(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
}
if (Symbol.dispose) BrowserCandidateKey.prototype[Symbol.dispose] = BrowserCandidateKey.prototype.free;

/**
 * Newly generated group and member, not a restored persona. Dropping or closing
 * the handle drops issuer/traffic custody; no method exports those secrets.
 */
export class BrowserInitialPersona {
    static __wrap(ptr) {
        const obj = Object.create(BrowserInitialPersona.prototype);
        obj.__wbg_ptr = ptr;
        BrowserInitialPersonaFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BrowserInitialPersonaFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_browserinitialpersona_free(ptr, 0);
    }
    /**
     * Drop volatile custody. Does not erase a separately committed member key,
     * nor promise that browser engine memory or stack spills are erased.
     */
    close() {
        wasm.browserinitialpersona_close(this.__wbg_ptr);
    }
    /**
     * Called only for an explicit local first-use operation. Storage inspection,
     * cancellation and atomic claim/persona installation belong to the caller.
     * @returns {Promise<BrowserInitialPersona>}
     */
    static generate() {
        const ret = wasm.browserinitialpersona_generate();
        return ret;
    }
    /**
     * Public initial group identity; unavailable after volatile custody ends.
     * @returns {Uint8Array}
     */
    group() {
        const ret = wasm.browserinitialpersona_group(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Public evidence only. The returned member CryptoKey is explicitly
     * unqualified browser custody. No issuer or derived key is placed in it.
     * This one-shot transfer is not a commit receipt; refusal must not retry by
     * silently minting a replacement. The issuer stays in this volatile handle.
     * @returns {any}
     */
    take_member_record() {
        const ret = wasm.browserinitialpersona_take_member_record(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) BrowserInitialPersona.prototype[Symbol.dispose] = BrowserInitialPersona.prototype.free;

/**
 * Opaque result of the core invitation evidence check. This does not attest
 * issuer custody, validity on its ruler, co-presence, or installation consent.
 */
export class BrowserInvitation {
    static __wrap(ptr) {
        const obj = Object.create(BrowserInvitation.prototype);
        obj.__wbg_ptr = ptr;
        BrowserInvitationFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BrowserInvitationFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_browserinvitation_free(ptr, 0);
    }
    /**
     * Public fields covered by the verified issuing member's signature.
     * @returns {Uint8Array}
     */
    statement() {
        const ret = wasm.browserinvitation_statement(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) BrowserInvitation.prototype[Symbol.dispose] = BrowserInvitation.prototype.free;

/**
 * Held public membership material. Construct only from an established group
 * and epoch policy, not from fields copied out of an untrusted certificate.
 * This object makes no network-freshness claim and does not persist itself.
 */
export class BrowserMembership {
    static __wrap(ptr) {
        const obj = Object.create(BrowserMembership.prototype);
        obj.__wbg_ptr = ptr;
        BrowserMembershipFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BrowserMembershipFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_browsermembership_free(ptr, 0);
    }
    /**
     * A verified revocation is terminal regardless of the certificate's epoch.
     * Full capacity refuses rather than evicting an older revocation.
     * @param {Uint8Array} subject
     * @param {bigint} epoch
     * @param {bigint} sequence
     * @param {number} reason
     * @param {Uint8Array} signature
     * @returns {boolean}
     */
    apply_revocation(subject, epoch, sequence, reason, signature) {
        const ptr0 = passArray8ToWasm0(subject, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.browsermembership_apply_revocation(this.__wbg_ptr, ptr0, len0, epoch, sequence, reason, ptr1, len1);
        return ret !== 0;
    }
    /**
     * Run the actual L5B authorization boundary, retaining its opaque result.
     * Caller owns the expected nonce, its lifetime and single-use enforcement.
     * @param {Uint8Array} statement
     * @param {Uint8Array} certificate
     * @param {Uint8Array} nonce
     * @param {Uint8Array} signature
     * @returns {BrowserInvitation | undefined}
     */
    authorise_invitation(statement, certificate, nonce, signature) {
        const ptr0 = passArray8ToWasm0(statement, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(certificate, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(nonce, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.browsermembership_authorise_invitation(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        return ret === 0 ? undefined : BrowserInvitation.__wrap(ret);
    }
    /**
     * Invalid group length returns no state. No certificate can advance current.
     * @param {Uint8Array} group
     * @param {bigint} current
     * @param {bigint} depth
     * @returns {BrowserMembership | undefined}
     */
    static establish(group, current, depth) {
        const ptr0 = passArray8ToWasm0(group, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.browsermembership_establish(ptr0, len0, current, depth);
        return ret === 0 ? undefined : BrowserMembership.__wrap(ret);
    }
    /**
     * Evaluates the actual core standing rules after authentication/context checks.
     * @param {Uint8Array} bytes
     * @param {Uint8Array} subject
     * @returns {string}
     */
    status(bytes, subject) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(subject, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.browsermembership_status(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Verify the member's actual L5 evidence against held epoch/revocation
     * state. Nonce issuance, single use and expiry belong to the caller.
     * @param {Uint8Array} bytes
     * @param {Uint8Array} subject
     * @param {Uint8Array} statement
     * @param {Uint8Array} nonce
     * @param {Uint8Array} signature
     * @returns {boolean}
     */
    verify_nonce(bytes, subject, statement, nonce, signature) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(subject, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(statement, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(nonce, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.browsermembership_verify_nonce(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        return ret !== 0;
    }
}
if (Symbol.dispose) BrowserMembership.prototype[Symbol.dispose] = BrowserMembership.prototype.free;

/**
 * Public metadata from a core-validated, volatile prepared persona.
 * No public constructor; no durable-installation or credential authority.
 */
export class BrowserPreparedPersona {
    static __wrap(ptr) {
        const obj = Object.create(BrowserPreparedPersona.prototype);
        obj.__wbg_ptr = ptr;
        BrowserPreparedPersonaFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BrowserPreparedPersonaFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_browserpreparedpersona_free(ptr, 0);
    }
    /**
     * @returns {Uint8Array}
     */
    group() {
        const ret = wasm.browserpreparedpersona_group(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Transfer the candidate's nonextractable browser key and core-validated
     * public metadata together. This record has NO hardware-sealing claim and
     * contains no group issuer or derived traffic keys. The enclosing runtime
     * owns atomic persistence and cannot treat this as a commit receipt.
     * @returns {any}
     */
    into_browser_record() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.browserpreparedpersona_into_browser_record(ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {Uint8Array}
     */
    member() {
        const ret = wasm.browserpreparedpersona_member(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) BrowserPreparedPersona.prototype[Symbol.dispose] = BrowserPreparedPersona.prototype.free;

/**
 * Bring the hive up and report what the platform provides. Returns the log as
 * a string so a caller can render it without touching the console.
 * @returns {string}
 */
export function boot() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.boot();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Bind a portal request and verifier nonce using the same Rust representation
 * as the host verifier. The browser's platform key signs these returned bytes.
 * @param {string} origin
 * @param {string} method
 * @param {string} path
 * @param {Uint8Array} body
 * @param {Uint8Array} nonce
 * @returns {Uint8Array}
 */
export function portal_request_message(origin, method, path, body, nonce) {
    const ptr0 = passStringToWasm0(origin, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(method, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(body, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(nonce, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ret = wasm.portal_request_message(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v6 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v6;
}

/**
 * Existing L5B short comparison string. The ephemeral session is never stored.
 * @param {Uint8Array} session
 * @param {Uint8Array} statement
 * @returns {Uint8Array}
 */
export function tg_ceremony_verification_string(session, statement) {
    const ptr0 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(statement, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.tg_ceremony_verification_string(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Check exact structure, expected identities and signature, not membership
 * currency or revocation. Expected identities must not come from an untrusted
 * certificate itself when deciding admission.
 * @param {Uint8Array} bytes
 * @param {Uint8Array} subject
 * @param {Uint8Array} group
 * @returns {boolean}
 */
export function tg_certificate_authentic(bytes, subject, group) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(subject, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(group, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.tg_certificate_authentic(ptr0, len0, ptr1, len1, ptr2, len2);
    return ret !== 0;
}

/**
 * Encode only a correctly signed certificate. Empty output means refusal.
 * @param {Uint8Array} subject
 * @param {Uint8Array} group
 * @param {bigint} epoch
 * @param {Uint8Array} signature
 * @returns {Uint8Array}
 */
export function tg_certificate_encode(subject, group, epoch, signature) {
    const ptr0 = passArray8ToWasm0(subject, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(group, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.tg_certificate_encode(ptr0, len0, ptr1, len1, epoch, ptr2, len2);
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Canonical bytes for the browser's asynchronous group signer. No new format.
 * @param {Uint8Array} subject
 * @param {Uint8Array} group
 * @param {bigint} epoch
 * @returns {Uint8Array}
 */
export function tg_certificate_signing_bytes(subject, group, epoch) {
    const ptr0 = passArray8ToWasm0(subject, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(group, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.tg_certificate_signing_bytes(ptr0, len0, ptr1, len1, epoch);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Existing L5B invitation statement for an asynchronous browser member signer.
 * Empty output refuses malformed identities, code or an unknown role.
 * @param {Uint8Array} group
 * @param {Uint8Array} issuer
 * @param {number} role
 * @param {Uint8Array} code
 * @param {bigint} validity
 * @returns {Uint8Array}
 */
export function tg_invitation_statement(group, issuer, role, code, validity) {
    const ptr0 = passArray8ToWasm0(group, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(issuer, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(code, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.tg_invitation_statement(ptr0, len0, ptr1, len1, role, ptr2, len2, validity);
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Canonical L5 evidence bytes for a verifier-issued nonce. The owner must
 * enforce nonce lifetime and single use; this encoder does not issue challenges.
 * @param {Uint8Array} statement
 * @param {Uint8Array} nonce
 * @returns {Uint8Array}
 */
export function tg_nonce_signing_bytes(statement, nonce) {
    const ptr0 = passArray8ToWasm0(statement, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(nonce, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.tg_nonce_signing_bytes(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Existing FORMATS 5a.1 signing bytes, for an asynchronous platform signer.
 * @param {Uint8Array} subject
 * @param {bigint} epoch
 * @param {bigint} sequence
 * @param {number} reason
 * @returns {Uint8Array}
 */
export function tg_revocation_signing_bytes(subject, epoch, sequence, reason) {
    const ptr0 = passArray8ToWasm0(subject, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.tg_revocation_signing_bytes(ptr0, len0, epoch, sequence, reason);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_fffb441def202758: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_browsercandidatekey_new: function(arg0) {
            const ret = BrowserCandidateKey.__wrap(arg0);
            return ret;
        },
        __wbg_browserinitialpersona_new: function(arg0) {
            const ret = BrowserInitialPersona.__wrap(arg0);
            return ret;
        },
        __wbg_call_44b7209e1e252e6a: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.call(arg1, arg2, arg3, arg4);
            return ret;
        }, arguments); },
        __wbg_call_a6e5c5dce5018821: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_e3b662382210db98: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_getRandomValues_3ce0f70b9d0e28af: function(arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg_get_78f252d074a84d0b: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_instanceof_Promise_4cb210c0b8f8c959: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Promise;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_log_0a1378f20f6be3a6: function(arg0, arg1) {
            console.log(getStringFromWasm0(arg0, arg1));
        },
        __wbg_new_32b398fb48b6d94a: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_cd45aabdf6073e84: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_da52cf8fe3429cb2: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_77cdfb7977362f3c: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_1824d93f294193e5: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h035cc2eb5922f70d(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_now_27578c82a7bf39b3: function() {
            const ret = performance.now();
            return ret;
        },
        __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_d2ae3af0c1217ae6: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_0ab5b2d2393e99b9: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_6a09b7bc46549209: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_resolve_2191a4dfe481c25b: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_set_8535240470bf2500: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_146583524fe1469b: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_then_16d107c451e9905d: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_6ec10ae38b3e92f7: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 51, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h708418ff5a6bdc03);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            var v0 = getArrayU8FromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 1, 1);
            // Cast intrinsic for `Vector(U8) -> Externref`.
            const ret = v0;
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./hive_wasm_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__h708418ff5a6bdc03(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h708418ff5a6bdc03(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h035cc2eb5922f70d(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h035cc2eb5922f70d(arg0, arg1, arg2, arg3);
}

const BrowserCandidateCeremonyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_browsercandidateceremony_free(ptr, 1));
const BrowserCandidateKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_browsercandidatekey_free(ptr, 1));
const BrowserInitialPersonaFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_browserinitialpersona_free(ptr, 1));
const BrowserInvitationFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_browserinvitation_free(ptr, 1));
const BrowserMembershipFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_browsermembership_free(ptr, 1));
const BrowserPreparedPersonaFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_browserpreparedpersona_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('hive_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
