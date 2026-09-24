//! Routing's ordinary-output view of a regulated bearer.
//!
//! Every send passes the existing L2 dispatcher and preserves its beacon
//! reservation. The radio owner retains exclusive access to physical control.

use crate::beacon_policy::{RegulatedDispatchRefusal, RegulatedDispatcher};
use r2_ident::HiveId;
use r2_transport::l1::{
    Bearer, BearerProfile, BearerState, BuildModeDeclarationCarriage, LinkQuality, ReceiveError,
    RegulatedBearer, RxMeta, SendError, SendTarget,
};

/// Ordinary admission delegated to another processor of the same complex hive.
/// Implementations must send exclusively through that processor's reservation-
/// enforcing dispatcher. This is an output operation, not permission to call a
/// raw radio. Queued acceptance still does not establish radio delivery.
pub trait ComponentDispatcher: Bearer {
    fn dispatch_ordinary(&mut self, target: SendTarget, frame: &[u8]) -> Result<(), SendError>;
}

/// Routing surface whose sends always invoke the component's admission operation.
/// No raw `Bearer` can be wrapped here without implementing that operation.
pub struct ComponentOutput<'a> {
    port: &'a mut dyn ComponentDispatcher,
}
impl<'a> ComponentOutput<'a> {
    pub fn new(port: &'a mut dyn ComponentDispatcher) -> Self {
        Self { port }
    }
}
impl Bearer for ComponentOutput<'_> {
    fn profile(&self) -> &BearerProfile {
        self.port.profile()
    }
    fn state(&self) -> BearerState {
        self.port.state()
    }
    fn max_payload(&self) -> u16 {
        self.port.max_payload()
    }
    fn relative_speed(&self, peer: HiveId) -> u8 {
        self.port.relative_speed(peer)
    }
    fn build_mode_declaration_carriage(&self) -> BuildModeDeclarationCarriage {
        self.port.build_mode_declaration_carriage()
    }
    fn send(&mut self, target: SendTarget, frame: &[u8]) -> Result<(), SendError> {
        self.port.dispatch_ordinary(target, frame)
    }
    fn poll_recv(&mut self, out: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
        self.port.poll_recv(out)
    }
    fn link_quality(&self, peer: HiveId) -> Option<LinkQuality> {
        self.port.link_quality(peer)
    }
    fn for_each_peer(&self, visit: &mut dyn FnMut(HiveId, LinkQuality)) {
        self.port.for_each_peer(visit)
    }
    fn quality_of_arrival(&self, hint: Option<i16>) -> Option<LinkQuality> {
        self.port.quality_of_arrival(hint)
    }
}

/// A borrowed output surface for ordinary routed traffic, including receipts.
/// Construct after priming the dispatcher's current window with the beacon.
pub struct OrdinaryOutput<'a> {
    port: &'a mut dyn RegulatedBearer,
    dispatcher: &'a mut RegulatedDispatcher,
}

impl<'a> OrdinaryOutput<'a> {
    pub fn new(port: &'a mut dyn RegulatedBearer, dispatcher: &'a mut RegulatedDispatcher) -> Self {
        Self { port, dispatcher }
    }
}

impl Bearer for OrdinaryOutput<'_> {
    fn profile(&self) -> &BearerProfile {
        self.port.profile()
    }
    fn state(&self) -> BearerState {
        self.port.state()
    }
    fn max_payload(&self) -> u16 {
        self.port.max_payload()
    }
    fn relative_speed(&self, peer: HiveId) -> u8 {
        self.port.relative_speed(peer)
    }
    fn build_mode_declaration_carriage(&self) -> BuildModeDeclarationCarriage {
        self.port.build_mode_declaration_carriage()
    }
    fn send(&mut self, target: SendTarget, frame: &[u8]) -> Result<(), SendError> {
        self.dispatcher
            .offer_other(self.port, target, frame)
            .map_err(|error| match error {
                RegulatedDispatchRefusal::Send(error) => error,
                _ => SendError::Unavailable,
            })
    }
    fn poll_recv(&mut self, out: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
        self.port.poll_recv(out)
    }
    fn link_quality(&self, peer: HiveId) -> Option<LinkQuality> {
        self.port.link_quality(peer)
    }
    fn for_each_peer(&self, visit: &mut dyn FnMut(HiveId, LinkQuality)) {
        self.port.for_each_peer(visit)
    }
    fn quality_of_arrival(&self, hint: Option<i16>) -> Option<LinkQuality> {
        self.port.quality_of_arrival(hint)
    }
}

/// A bounded deferred offer whose physical owner will invoke the ordinary L2
/// dispatcher after its receive/suppression deadline. Queueing does not spend
/// airtime or establish transmission. The owner must never send these bytes
/// without a fresh dispatcher admission, and must preserve relay priority.
type Defer<'a> = dyn FnMut(SendTarget, &[u8]) -> Result<(), SendError> + 'a;

pub struct DeferredOutput<'a> {
    port: &'a mut dyn RegulatedBearer,
    defer: &'a mut Defer<'a>,
}
impl<'a> DeferredOutput<'a> {
    pub fn new(port: &'a mut dyn RegulatedBearer, defer: &'a mut Defer<'a>) -> Self {
        Self { port, defer }
    }
}
impl Bearer for DeferredOutput<'_> {
    fn profile(&self) -> &BearerProfile {
        self.port.profile()
    }
    fn state(&self) -> BearerState {
        self.port.state()
    }
    fn max_payload(&self) -> u16 {
        self.port.max_payload()
    }
    fn relative_speed(&self, peer: HiveId) -> u8 {
        self.port.relative_speed(peer)
    }
    fn build_mode_declaration_carriage(&self) -> BuildModeDeclarationCarriage {
        self.port.build_mode_declaration_carriage()
    }
    fn send(&mut self, target: SendTarget, frame: &[u8]) -> Result<(), SendError> {
        (self.defer)(target, frame)
    }

    fn poll_recv(&mut self, out: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
        self.port.poll_recv(out)
    }
    fn link_quality(&self, peer: HiveId) -> Option<LinkQuality> {
        self.port.link_quality(peer)
    }
    fn for_each_peer(&self, visit: &mut dyn FnMut(HiveId, LinkQuality)) {
        self.port.for_each_peer(visit)
    }
    fn quality_of_arrival(&self, hint: Option<i16>) -> Option<LinkQuality> {
        self.port.quality_of_arrival(hint)
    }
}
