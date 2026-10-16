import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  createImageComment,
  deleteImageComment,
  fetchImageComments,
  updateImageComment,
} from '../api/images';
import useRouteRequestOwnership, { isAbortError } from '../utils/useRouteRequestOwnership';

function ImageComments({ imageId, loading, setLoading, setError, readOnly = false }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const imageIdStr = imageId == null ? '' : String(imageId);
  const commentsRef = useRef([]);
  const pendingMutationsRef = useRef(new Map());
  const setLoadingRef = useRef(setLoading);
  const setErrorRef = useRef(setError);
  const {
    beginRequest,
    isCurrent,
    releaseRequest
  } = useRouteRequestOwnership(`image:${imageIdStr}`);

  setLoadingRef.current = setLoading;
  setErrorRef.current = setError;

  const updateComments = useCallback((updater, owner) => {
    if (owner && !isCurrent(owner)) {
      return;
    }

    const nextComments = typeof updater === 'function'
      ? updater(commentsRef.current)
      : updater;
    commentsRef.current = nextComments;
    setComments(nextComments);
  }, [isCurrent]);

  const beginMutation = useCallback(() => {
    const request = beginRequest();
    pendingMutationsRef.current.forEach((_, generation) => {
      if (generation !== request.generation) {
        pendingMutationsRef.current.delete(generation);
      }
    });
    const pendingCount = pendingMutationsRef.current.get(request.generation) || 0;
    pendingMutationsRef.current.set(request.generation, pendingCount + 1);
    if (isCurrent(request)) {
      setLoadingRef.current?.(true);
    }
    return request;
  }, [beginRequest, isCurrent]);

  const finishMutation = useCallback((request) => {
    const pendingCount = pendingMutationsRef.current.get(request.generation) || 0;
    const nextCount = Math.max(0, pendingCount - 1);
    if (nextCount === 0) {
      pendingMutationsRef.current.delete(request.generation);
    } else {
      pendingMutationsRef.current.set(request.generation, nextCount);
    }

    if (isCurrent(request) && nextCount === 0) {
      setLoadingRef.current?.(false);
    }
    releaseRequest(request);
  }, [isCurrent, releaseRequest]);

  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Load comments for the image
  useEffect(() => {
    commentsRef.current = [];
    setComments([]);
    setNewComment('');
    setEditingComment(null);

    if (!imageIdStr) {
      return undefined;
    }

    const request = beginRequest();

    const loadComments = async () => {
      try {
        const commentsData = await fetchImageComments(imageIdStr, {
          signal: request.controller.signal
        });

        if (!Array.isArray(commentsData)) {
          throw new Error('Invalid comments response');
        }
        if (!isCurrent(request)) {
          return;
        }
        updateComments(commentsData, request);
        
      } catch (error) {
        if (!isCurrent(request) || isAbortError(error, request)) {
          return;
        }
        setErrorRef.current?.('Failed to load comments. Please try again later.');
      } finally {
        releaseRequest(request);
      }
    };

    loadComments();

    return () => {
      request.controller.abort();
    };
  }, [beginRequest, imageIdStr, isCurrent, releaseRequest, updateComments]);

  // Handle adding a comment
  const handleAddComment = async (e) => {
    e.preventDefault();
    
    if (newComment.trim() === '') {
      setErrorRef.current?.('Comment text cannot be empty');
      return;
    }
    
    const request = beginMutation();
    try {
      const newCommentData = await createImageComment(imageIdStr, newComment, {
        signal: request.controller.signal,
      });

      if (!isCurrent(request)) {
        return;
      }
      
      // Add the new comment to the list
      updateComments(prev => [...prev, newCommentData], request);
      
      // Reset form
      setNewComment('');
      setErrorRef.current?.(null);
      
    } catch (error) {
      if (!isCurrent(request) || isAbortError(error, request)) {
        return;
      }
      setErrorRef.current?.('Failed to add comment. Please try again later.');
    } finally {
      finishMutation(request);
    }
  };

  // Handle updating a comment
  const handleUpdateComment = async () => {
    if (!editingComment) return;

    const commentToUpdate = { ...editingComment };
    const request = beginMutation();

    try {
      const updatedComment = await updateImageComment(commentToUpdate.id, commentToUpdate.text, {
        signal: request.controller.signal,
      });

      if (!isCurrent(request)) {
        return;
      }

      // Update the comment in the list
      updateComments(prev =>
        prev.map(comment =>
          String(comment.id) === String(commentToUpdate.id) ? updatedComment : comment
        ),
        request
      );

      // Exit inline editing
      setEditingComment(null);
      setErrorRef.current?.(null);

    } catch (error) {
      if (!isCurrent(request) || isAbortError(error, request)) {
        return;
      }
      setErrorRef.current?.('Failed to update comment. Please try again later.');
    } finally {
      finishMutation(request);
    }
  };

  // Handle deleting a comment
  const handleDeleteComment = async (id) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) {
      return;
    }
    
    const request = beginMutation();
    try {
      await deleteImageComment(id, {
        signal: request.controller.signal,
      });

      if (!isCurrent(request)) {
        return;
      }
      
      // Remove the comment from the list
      updateComments(
        prev => prev.filter(comment => String(comment.id) !== String(id)),
        request
      );
      setErrorRef.current?.(null);
      
    } catch (error) {
      if (!isCurrent(request) || isAbortError(error, request)) {
        return;
      }
      setErrorRef.current?.('Failed to delete comment. Please try again later.');
    } finally {
      finishMutation(request);
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
                      <div onClick={() => { if (!readOnly) setEditingComment(comment); }} style={{ cursor: readOnly ? 'default' : 'pointer' }}>
                        {comment.text}
                      </div>
                    )}
                  </div>
                  {!readOnly && (
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
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No comments for this image. Add a comment to get started.</p>
          )}
        </div>
        
        {!readOnly && (
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
        )}
      </div>

    </div>
  );
}

export default ImageComments;
