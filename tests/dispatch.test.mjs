import { dispatch } from '../lib/dispatch.js';
const r = await dispatch(true);
console.log('没有令牌时:', JSON.stringify(r));
console.log(r.ok === false && r.status === 501 ? 'OK  缺少令牌时给出明确错误' : 'FAIL');
// 用假令牌验证请求形状（会拿到 GitHub 的 401/404，说明请求发得出去）
process.env.GITHUB_DISPATCH_TOKEN = 'github_pat_fake_for_shape_test';
const r2 = await dispatch(true);
console.log('假令牌时:', JSON.stringify(r2));
console.log((r2.status === 401 || r2.status === 404) ? 'OK  请求形状正确（GitHub 回了 ' + r2.status + '）' : 'NOTE 状态 ' + r2.status);
