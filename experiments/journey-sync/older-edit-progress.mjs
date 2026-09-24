// The last explicitly acknowledged old-copy snapshot becomes the next review's
// baseline. Keep the original migration snapshot intact for recovery.
export async function readOlderEditProgress({store,group,member,sourceRaw}){
  const pointer=await store.read('along-older-edit-pending-v1',group);
  if(!pointer)return {pointer:null,sourceRaw,pendingReviewId:null};
  const value=pointer.value;
  if(!value||![1,2].includes(value.format)||value.member!==member||!/^[0-9a-f]{64}$/.test(value.reviewId))throw Error('Older-edit progress unavailable');
  const decision=await store.read('along-older-edit-decisions-v1',value.reviewId);
  if(decision?.value?.format!==1||decision.value.member!==member||decision.value.reviewId!==value.reviewId
      ||decision.value.input?.actor!==member||typeof decision.value.input.sourceRaw!=='string'
      ||(decision.value.input.profileSourceRaw??decision.value.input.sourceRaw)!==sourceRaw)throw Error('Older-edit decision unavailable');
  if(value.format===1)return {pointer,sourceRaw:decision.value.input.sourceRaw,pendingReviewId:value.reviewId};
  const application=await store.read('along-older-edit-applications-v1',value.reviewId);
  if(typeof value.olderRaw!=='string'||value.olderRaw!==decision.value.input.olderRaw
      ||application?.value?.format!==1||application.value.member!==member||application.value.reviewId!==value.reviewId
      ||application.value.complete!==true||application.value.olderRaw!==value.olderRaw)throw Error('Older-edit acknowledgment unavailable');
  return {pointer,sourceRaw:value.olderRaw,pendingReviewId:null};
}
