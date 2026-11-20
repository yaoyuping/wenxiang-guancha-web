'use strict';
// Literal user-observed calendar time; never substitute creation time or timezone.
function observedTime(value) {
 if (value == null || value === '') return null;
 if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d)?$/.test(value)) throw Object.assign(new Error('观察／拍摄时间应为YYYY-MM-DD，可附THH:mm；未知可留空'), { publicMessage:'观察／拍摄时间格式错误，未知可留空' });
 const date=value.slice(0,10), parsed=new Date(date+'T00:00:00Z');
 if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date || (value.length>10 && (Number(value.slice(11,13))>23 || Number(value.slice(14,16))>59))) throw Object.assign(new Error('观察／拍摄日期时间无效'), { publicMessage:'观察／拍摄日期时间无效' });
 return value;
}
module.exports={observedTime};
