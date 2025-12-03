import React, { useState, useEffect } from 'react';

function ImageComments({ imageId, loading, setLoading, setError }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState(null);

  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Load comments for the image
  useEffect(() => {
    const loadComments = async () => {
      try {
        const response = await fetch(`/api/images/${imageId}/comments`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const commentsData = await response.json();
        setComments(commentsData);
        
      } catch (error) {
        console.error('Error loading comments:', error);
        setError('Failed to load comments. Please try again later.');
      }
    };

    if (imageId) {
      loadComments();
    }
  }, [imageId, setError]);

  // Handle adding a comment
  const handleAddComment = async (e) => {
    e.preventDefault();
    
    if (newComment.trim() === '') {
      setError('Comment text cannot be empty');
      return;
    }
    
    try {
      setLoading(true);
      
      console.log("Adding comment for image ID:", imageId);
      
      // Create the request payload
      const payload = {
        text: newComment,
      };
      
      console.log("Comment request payload:", JSON.stringify(payload, null, 2));
      
      const response = await fetch(`/api/images/${imageId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      console.log("Comment response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Comment error response:", errorText);
        throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
      }
      
      const newCommentData = await response.json();
      
      // Add the new comment to the list
      setComments(prev => [...prev, newCommentData]);
      
      // Reset form
      setNewComment('');
      setError(null);
      
    } catch (error) {
      console.error('Error creating comment:', error);
      setError('Failed to add comment. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // Handle updating a comment
  const handleUpdateComment = async () => {
    if (!editingComment) return;

    try {
      setLoading(true);

      const response = await fetch(`/api/comments/${editingComment.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: editingComment.text,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const updatedComment = await response.json();

      // Update the comment in the list
      setComments(prev =>
        prev.map(comment =>
          comment.id === editingComment.id ? updatedComment : comment
        )
      );

      // Exit inline editing
      setEditingComment(null);
      setError(null);

    } catch (error) {
      console.error('Error updating comment:', error);
      setError('Failed to update comment. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // Handle deleting a comment
  const handleDeleteComment = async (id) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) {
      return;
    }
    
    try {
      setLoading(true);
      
      const response = await fetch(`/api/comments/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      // Remove the comment from the list
      setComments(prev => prev.filter(comment => comment.id !== id));
      setError(null);
      
    } catch (error) {
      console.error('Error deleting comment:', error);
      setError('Failed to delete comment. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" id="comments-card">
      <div className="card-header">
        <h2>Comments</h2>
      </div>
      <div className="card-content">
        <div id="comments-container">
          {loading && !comments.length ? (
            <p>Loading comments...</p>
          ) : comments.length > 0 ? (
            <ul className="comments-list">
              {comments.map(comment => (
                <li key={comment.id} className="comment-item">
                  <div className="comment-header">
                    <span className="comment-author">
                      {comment.author ? comment.author.email : 'Unknown user'}
                    </span>
                    <span className="comment-date">
                      {formatDate(comment.created_at)}
                    </span>
                  </div>
                  <div className="comment-content">
                    {editingComment && editingComment.id === comment.id ? (
                      <div className="inline-edit">
                        <textarea
                          className="comment-edit-textarea-inline"
                          rows="4"
                          value={editingComment.text}
                          onChange={(e) => setEditingComment({...editingComment, text: e.target.value})}
                          placeholder="Enter your comment text here..."
                          autoFocus
                        ></textarea>
                        <div className="inline-edit-actions">
                          <button
                            className="btn btn-small btn-primary"
                            onClick={handleUpdateComment}
                            disabled={loading}
                          >
                            {loading ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={() => {
                              setEditingComment(null);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div onClick={() => setEditingComment(comment)} style={{ cursor: 'pointer' }}>
                        {comment.text}
                      </div>
                    )}
                  </div>
                  <div className="comment-actions">
                    {(!editingComment || editingComment.id !== comment.id) && (
                      <button
                        className="btn btn-small"
                        onClick={() => setEditingComment(comment)}
                      >
                        Edit
                      </button>
                    )}
                    <button 
                      className="btn btn-small btn-danger"
                      onClick={() => handleDeleteComment(comment.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>No comments for this image. Add a comment to get started.</p>
          )}
        </div>
        
        <form id="add-comment-form" className="form" onSubmit={handleAddComment}>
          <h3>Add Comment</h3>
          <div className="form-group">
            <label htmlFor="comment-text">Comment:</label>
            <textarea 
              id="comment-text" 
              name="comment-text" 
              rows="3" 
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              required
            ></textarea>
          </div>
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={loading}
          >
            Add Comment
          </button>
        </form>
      </div>

    </div>
  );
}

export default ImageComments;
