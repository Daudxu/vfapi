const express = require('express');
const phpUnserialize = require('php-serialize').unserialize;
const mysql = require('mysql2');

const app = express();
const port = 9527;

// 设置接口密钥
const API_SECRET_KEY = '664f142b83701c3660c15cb3cba09d81'; // 替换为您的实际密钥

// 使用 express.json() 中间件以解析请求体
app.use(express.json());

// 封装响应处理函数
function sendSuccessResponse(res, data, msg = true) {
    res.status(200).json({ code: 200, data, msg });
}

function sendErrorResponse(res, statusCode, errorMessage, data = null) {
    res.status(statusCode).json({ code: statusCode, data, msg: false, errorMessage });
}

// 创建数据库连接池
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'zhaosucai',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 连接到数据库
pool.getConnection((err, connection) => {
  if (err) {
    console.error('连接数据库失败: ', err);
    return;
  }
  console.log('成功连接到数据库');
  connection.release();
});

// 定义一个处理效验码查询的路由
app.get('/verify', (req, res) => {
    const md5 = req.query.md5;
    if (!md5) {
        return sendErrorResponse(res, 400, '无效的MD5参数');
    }

    pool.getConnection((err, connection) => {
        if (err) {
            console.error('获取数据库连接失败: ', err);
            return sendErrorResponse(res, 500, '数据库连接错误');
        }

        const query = 'SELECT meta_value FROM tb_postmeta WHERE meta_value LIKE ?';
        connection.query(query, [`%${md5}%`], (err, results) => {
            connection.release();

            if (err) {
                console.error('数据库查询错误: ', err);
                return sendErrorResponse(res, 500, '数据库查询错误');
            }

            if (results.length === 0) {
                return sendErrorResponse(res, 404, '未找到相关数据', null);
            }

            try {
                const metaValue = results[0].meta_value;
                const parsedData = phpUnserialize(metaValue);
                sendSuccessResponse(res, parsedData);
            } catch (parseError) {
                console.error('解析错误: ', parseError);
                sendErrorResponse(res, 500, '解析数据错误');
            }
        });
    });
});

// 定义一个插入或更新字段的路由
app.post('/postdata', (req, res) => {
    const { secret_key, post_id, meta_data } = req.body;

    // 验证接口密钥
    if (!secret_key || secret_key !== API_SECRET_KEY) {
        return sendErrorResponse(res, 403, '接口密钥无效或未提供');
    }

    // 验证必要字段
    if (!post_id || !meta_data || !Array.isArray(meta_data)) {
        return sendErrorResponse(res, 400, '缺少必要字段: post_id 或 meta_data');
    }

    pool.getConnection((err, connection) => {
        if (err) {
            console.error('获取数据库连接失败: ', err);
            return sendErrorResponse(res, 500, '数据库连接错误');
        }

        // 使用 Promise 处理每个 meta_data 的插入或更新操作
        const operations = meta_data.map(({ meta_key, meta_value }) => {
            return new Promise((resolve, reject) => {
                // 验证 meta_key 和 meta_value 是否有效
                if (!meta_key || meta_value === undefined) {
                    return reject(new Error(`meta_key 或 meta_value 无效: ${meta_key}, ${meta_value}`));
                }

                // 查询是否已经存在对应的 post_id 和 meta_key
                const selectQuery = 'SELECT * FROM tb_postmeta WHERE post_id = ? AND meta_key = ?';
                connection.query(selectQuery, [post_id, meta_key], (selectErr, results) => {
                    if (selectErr) {
                        return reject(selectErr);
                    }

                    if (results.length > 0) {
                        // 如果记录存在，则更新 meta_value
                        const updateQuery = 'UPDATE tb_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?';
                        connection.query(updateQuery, [meta_value, post_id, meta_key], (updateErr) => {
                            if (updateErr) {
                                return reject(updateErr);
                            }
                            resolve({ action: 'updated', meta_key, meta_value });
                        });
                    } else {
                        // 如果记录不存在，则插入新记录
                        const insertQuery = 'INSERT INTO tb_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)';
                        connection.query(insertQuery, [post_id, meta_key, meta_value], (insertErr) => {
                            if (insertErr) {
                                return reject(insertErr);
                            }
                            resolve({ action: 'inserted', meta_key, meta_value });
                        });
                    }
                });
            });
        });

        // 处理所有操作
        Promise.allSettled(operations)
            .then((results) => {
                connection.release();

                // 格式化响应数据
                const responseData = results.map((result) =>
                    result.status === 'fulfilled'
                        ? result.value
                        : { error: result.reason.message }
                );

                sendSuccessResponse(res, responseData, '操作完成');
            })
            .catch((finalErr) => {
                connection.release();
                console.error('操作失败: ', finalErr);
                sendErrorResponse(res, 500, '操作失败');
            });
    });
});



// 启动服务器
app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});
